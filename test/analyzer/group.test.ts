import { describe, it, expect } from "vitest";
import { buildGroupPrompt, extractGroupAssignments, groupCardLine, makeGroupBatches, parseMergeReply, groupCards, GROUP_MARKER } from "../../src/analyzer/group.js";
import type { FileCardFrontmatter } from "../../src/core/schema.js";
import type { SanitizedText } from "../../src/privacy/sanitized.js";

const card = (over: Partial<FileCardFrontmatter> = {}): FileCardFrontmatter => ({
  schema_version: 1, kind: "file", source: "/home/u/비밀경로/보고서.pdf", source_hash: "sha256:abc", format: "pdf", size: 1, modified: "2025-06-01",
  duplicates: [], type: "보고서", use_for: [], title: "캡스톤 보고서", summary: "요약 010-1234-5678", period: "2025-03 ~ 2025-06",
  role: null, skills: ["Python"], metrics: ["정확도 92%"], org: "연세대", value: "상", value_reason: "근거", in_resume: "판단불가",
  agent: "claude", generated_at: "x", ...over,
});
const S = (s: string) => s as SanitizedText;

describe("group prompt (11.1)", () => {
  it("sends only the allowed card fields, masked, and never the source path or hash", () => {
    const line = groupCardLine(card());
    expect(JSON.parse(line)).toEqual({ type: "보고서", title: "캡스톤 보고서", summary: "요약 [전화번호]", period: "2025-03 ~ 2025-06", role: null, org: "연세대", skills: ["Python"], metrics: ["정확도 92%"], value: "상" });
    const p = buildGroupPrompt([{ id: "c1", line }], [{ id: "e1", line: S('{"title":"기존","period":null,"org":null}') }]);
    expect(p.startsWith(GROUP_MARKER)).toBe(true);
    expect(p).not.toContain("비밀경로");
    expect(p).not.toContain("sha256");
    expect(p).toMatch(/<<<CARD id=c1 nonce=[0-9a-f]+>>>/);
    expect(p).toMatch(/<<<EXP id=e1 nonce=[0-9a-f]+>>>/);
  });
});

describe("category and period questions (11.4)", () => {
  it("asks for category and tells the LLM not to ask contribution/period", () => {
    const p = buildGroupPrompt([{ id: "c1", line: S("{}") }], []);
    expect(p).toContain('"category":"프로젝트|연구|대회·CTF|교육·수업|동아리·스터디|기타"');
    expect(p).toContain("본인 기여도·AI 활용 정도와 기간은 묻지 마세요");
  });
  it("drops period questions from new experiences and attach, and nulls an invalid category", () => {
    const t = JSON.stringify({
      experiences: [
        { title: "A", type: "보고서", category: "연구", evidence: ["c1"], questions: [{ field: "period", q: "언제였나요?" }, { field: "role", q: "역할?" }] },
        { title: "B", type: "보고서", category: "아무거나", evidence: ["c2"], questions: [] },
      ],
      attach: [{ card: "c3", experience: "e1", questions: [{ field: "period", q: "언제?" }, { field: "org", q: "소속?" }] }],
      unassigned: [],
    });
    const items = extractGroupAssignments(t, new Set(["e1"])) as any[];
    expect(items[0].exp.category).toBe("연구");
    expect(items[0].exp.questions).toEqual([{ field: "role", q: "역할?" }]);
    expect(items[1].exp.category).toBeNull();
    expect(items[2].questions).toEqual([{ field: "org", q: "소속?" }]);
  });
});

describe("group reply (11.1 검증)", () => {
  const reply = JSON.stringify({
    experiences: [{ title: "캡스톤", type: "보고서", period: null, org: null, role: null, team_size: null, skills: [], metrics: [], evidence: ["c1", "c2"], questions: [{ field: "role", q: "역할?" }, { field: "metrics", q: "a" }, { field: "org", q: "b" }, { field: "other", q: "c" }] }],
    attach: [{ card: "c3", experience: "e1", questions: [{ field: "metrics", q: "성과?" }] }],
    unassigned: ["c4"],
  });
  it("flattens experiences, attach and unassigned into one item per card, capping questions at 3", () => {
    const items = extractGroupAssignments("결과:\n" + reply, new Set(["e1"])) as any[];
    expect(items.map((i) => [i.id, i.kind])).toEqual([["c1", "new"], ["c2", "new"], ["c3", "attach"], ["c4", "unassigned"]]);
    expect(items[0].exp).toBe(items[1].exp);
    expect(items[0].exp.questions).toHaveLength(3);
  });
  it("drops a question whose first line is empty but keeps the experience (I2)", () => {
    const t = JSON.stringify({
      experiences: [{ title: "캡스톤", type: "보고서", evidence: ["c1"], questions: [{ field: "role", q: "\n역할?" }, { field: "metrics", q: "성과?" }, { q: 5 }] }],
      attach: [{ card: "c2", experience: "e1", questions: [{ field: "role", q: "  \n?" }, { field: "org", q: "소속?" }] }],
      unassigned: [],
    });
    const items = extractGroupAssignments(t, new Set(["e1"])) as any[];
    expect(items.map((i) => i.id)).toEqual(["c1", "c2"]);
    expect(items[0].exp.questions).toEqual([{ field: "metrics", q: "성과?" }]);
    expect(items[1].questions).toEqual([{ field: "org", q: "소속?" }]);
  });
  it("drops attach targets that are not existing experiences (the card is then missing and retried)", () => {
    const bad = JSON.stringify({ experiences: [], attach: [{ card: "c3", experience: "e9" }], unassigned: [] });
    expect(extractGroupAssignments(bad, new Set(["e1"]))).toEqual([]);
  });
  it("returns null when there is no object with the expected keys", () => {
    expect(extractGroupAssignments("묶을 수 없습니다", new Set())).toBeNull();
  });
});

describe("batches and merge", () => {
  it("splits by line length", () => {
    const cards = Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, line: S("x".repeat(400)) }));
    expect(makeGroupBatches(cards, 1000).map((b) => b.length)).toEqual([2, 2, 1]);
  });
  it("parses merge groups of known keys, each key once", () => {
    const keys = new Set(["n1", "n2", "n3", "n4"]);
    expect(parseMergeReply('{"merge":[["n1","n3"],["n2","n3"],["n4"],["n1","zz"]]}', keys)).toEqual([["n1", "n3"]]);
    expect(parseMergeReply("병합할 것 없음", keys)).toEqual([]);
  });
});

describe("groupCards", () => {
  it("retries cards missing from the reply in the same session and reports each assignment", async () => {
    const sessions: string[] = []; let call = 0;
    const bridge = {
      newSession: async () => { sessions.push(`s${sessions.length}`); return sessions.at(-1)!; },
      prompt: async (_s: string, text: string) => {
        call++;
        if (call === 1) return { ok: true as const, text: JSON.stringify({ experiences: [{ title: "A", type: "보고서", evidence: ["c1"], questions: [] }], attach: [], unassigned: [] }) };
        expect(text).toContain("c2");
        return { ok: true as const, text: JSON.stringify({ experiences: [], attach: [], unassigned: ["c2"] }) };
      },
    };
    const got: string[] = [];
    const r = await groupCards(bridge as any, [[{ id: "c1", line: S("{}") }, { id: "c2", line: S("{}") }]], [], {
      timeoutMs: 1000, onAssigned: async (a) => { got.push(`${a.id}:${a.kind}`); },
    });
    expect(r.stopped).toBeNull();
    expect(got).toEqual(["c1:new", "c2:unassigned"]);
    expect(sessions).toHaveLength(1);
  });
});
