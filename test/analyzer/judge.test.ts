import { describe, it, expect, afterEach } from "vitest";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { judgeCards, loadJudgeItem, JUDGE_BATCH_SIZE, type JudgeItem } from "../../src/analyzer/judge.js";
import { buildJudgePrompt } from "../../src/analyzer/prompt.js";
import { NO_RESULTS_DETAIL } from "../../src/analyzer/analyze.js";
import type { AgentReply } from "../../src/agent/bridge.js";
import type { JudgeResult } from "../../src/core/schema.js";
import { writeFileCard } from "../../src/store/cards.js";
import { mkTmp } from "../helpers/tmp.js";

const judgeItem = (id: string, tag = id): JudgeItem => ({
  id, card: `files/2025-CARDPATH-${tag}.md`,
  fields: {
    type: "보고서", use_for: ["포트폴리오"], title: `제목 ${tag}`, summary: `SUMMARY-${tag}`, period: "2025-03 ~ 2025-06",
    role: "팀장", skills: ["Python"], metrics: ["정확도 92%"], org: null, detail: `DETAIL-${tag}\n둘째 줄`,
  },
});
const idsIn = (t: string) => [...t.matchAll(/^<<<CARD id=(\S+)/gm)].map((m) => m[1]);
const retryIds = (t: string) => t.match(/다음 카드 id들에 대해서만[^:]*: (.+)$/m)?.[1].split(",").map((x) => x.trim()) ?? [];
const answer = (ids: string[]) => JSON.stringify(ids.map((id) => ({ id, value: "상", value_reason: "근거" })));

function fakeBridge(replies: ((prompt: string) => AgentReply)[]) {
  let i = 0, sessions = 0;
  const prompts: string[] = [];
  return {
    prompts, sessionsOpened: () => sessions,
    newSession: async () => `s${++sessions}`,
    prompt: async (_s: string, t: string) => { prompts.push(t); return replies[Math.min(i++, replies.length - 1)](t); },
  };
}
const opts = (judged: Map<string, JudgeResult>) => ({
  timeoutMs: 1000, batchSize: JUDGE_BATCH_SIZE, onJudged: async (id: string, r: JudgeResult) => { judged.set(id, r); },
});

describe("buildJudgePrompt", () => {
  it("states the five criteria and absolute grading, and sends only card fields", () => {
    const p = buildJudgePrompt([judgeItem("c1", "UNIQ")]);
    for (const k of ["정량 성과의 구체성", "본인 역할의 명확성", "직무 관련 기술의 깊이", "결과물·증빙 존재", "최근성", "절대 평가"]) expect(p).toContain(k);
    expect(p).toContain("SUMMARY-UNIQ");
    expect(p).toContain("DETAIL-UNIQ");
    expect(p).not.toContain("CARDPATH");
    expect(idsIn(p)).toEqual(["c1"]);
  });
});

describe("buildJudgePrompt allowlist", () => {
  it("serializes only the allowed keys even if fields carries extras", () => {
    const it0 = judgeItem("c1");
    const p = buildJudgePrompt([{ ...it0, fields: { ...it0.fields, source: "/secret/path", excerpts: ["EXC"] } as any }]);
    expect(p).not.toContain("/secret/path");
    expect(p).not.toContain("EXC");
    const line = p.split("\n").find((l) => l.startsWith("{"))!;
    expect(Object.keys(JSON.parse(line))).toEqual(["type", "use_for", "title", "summary", "period", "role", "skills", "metrics", "org", "detail"]);
  });
});

describe("judgeCards", () => {
  it("sends no paths or source text: only the JudgeItem fields (summary/detail included, card path not)", async () => {
    const judged = new Map<string, JudgeResult>();
    const b = fakeBridge([(t) => ({ ok: true, text: answer(idsIn(t)) })]);
    const r = await judgeCards(b, [judgeItem("c1", "AAA"), judgeItem("c2", "BBB")], opts(judged));
    expect(r.stopped).toBeNull();
    expect([...judged.keys()]).toEqual(["c1", "c2"]);
    const all = b.prompts.join("\n");
    for (const u of ["SUMMARY-AAA", "DETAIL-AAA", "SUMMARY-BBB", "DETAIL-BBB"]) expect(all).toContain(u);
    expect(all).not.toContain("CARDPATH");
    expect(all).not.toContain("files/");
  });

  it("batches by 40 cards", async () => {
    const judged = new Map<string, JudgeResult>();
    const b = fakeBridge([(t) => ({ ok: true, text: answer(idsIn(t)) })]);
    await judgeCards(b, Array.from({ length: 81 }, (_, i) => judgeItem(`c${i}`)), opts(judged));
    expect(b.prompts.map((p) => idsIn(p).length)).toEqual([40, 40, 1]);
    expect(judged.size).toBe(81);
  });

  it("re-asks once for missing ids, then leaves them unjudged", async () => {
    const judged = new Map<string, JudgeResult>();
    const b = fakeBridge([
      () => ({ ok: true, text: answer(["c1"]) }),
      (t) => ({ ok: true, text: answer(retryIds(t)) }),
    ]);
    const r = await judgeCards(b, [judgeItem("c1"), judgeItem("c2"), judgeItem("c3")], opts(judged));
    expect(r.stopped).toBeNull();
    expect(b.prompts).toHaveLength(2);
    expect(retryIds(b.prompts[1])).toEqual(["c2", "c3"]);
    expect([...judged.keys()].sort()).toEqual(["c1", "c2", "c3"]);

    const judged2 = new Map<string, JudgeResult>();
    const b2 = fakeBridge([() => ({ ok: true, text: answer(["c1"]) }), () => ({ ok: true, text: "[]" })]);
    expect((await judgeCards(b2, [judgeItem("c1"), judgeItem("c2")], opts(judged2))).stopped).toBeNull();
    expect([...judged2.keys()]).toEqual(["c1"]);
  });

  it("rejects invalid values", async () => {
    const judged = new Map<string, JudgeResult>();
    const b = fakeBridge([() => ({ ok: true, text: JSON.stringify([{ id: "c1", value: "최상", value_reason: "r" }]) })]);
    await judgeCards(b, [judgeItem("c1")], opts(judged));
    expect(judged.size).toBe(0);
  });

  it("stops on rate limit (RPC error and service text)", async () => {
    const judged = new Map<string, JudgeResult>();
    const b = fakeBridge([(t) => ({ ok: true, text: answer(idsIn(t)) }), () => ({ ok: false, kind: "rate_limit", detail: "429" })]);
    const items = Array.from({ length: 81 }, (_, i) => judgeItem(`c${i}`));
    const r = await judgeCards(b, items, opts(judged));
    expect(r.stopped?.kind).toBe("rate_limit");
    expect(judged.size).toBe(40);

    const b2 = fakeBridge([() => ({ ok: true, text: "You've hit your usage limit. Upgrade to Plus to continue using Codex." })]);
    expect((await judgeCards(b2, [judgeItem("c1")], opts(new Map()))).stopped?.kind).toBe("rate_limit");
  });

  it("circuit breaker: 2 consecutive batches without JSON → no_results, nothing more sent", async () => {
    const b = fakeBridge([() => ({ ok: true, text: "모델을 찾을 수 없습니다." })]);
    const r = await judgeCards(b, Array.from({ length: 120 }, (_, i) => judgeItem(`c${i}`)), opts(new Map()));
    expect(r.stopped).toEqual({ kind: "no_results", detail: NO_RESULTS_DETAIL });
    // 배치마다 본 요청 + 재요청 1회, 배치 2개에서 멈춤
    expect(b.prompts.filter((p) => idsIn(p).length > 0)).toHaveLength(2);
    expect(b.prompts).toHaveLength(4);
  });

  it("opens one session per judge batch (§9.7 A)", async () => {
    const b = fakeBridge([(t) => ({ ok: true, text: answer(idsIn(t)) })]);
    await judgeCards(b, Array.from({ length: 81 }, (_, i) => judgeItem(`c${i}`)), opts(new Map()));
    expect(b.sessionsOpened()).toBe(3);
  });

  it("does nothing for an empty list", async () => {
    const b = fakeBridge([() => ({ ok: true, text: "[]" })]);
    expect((await judgeCards(b, [], opts(new Map()))).stopped).toBeNull();
    expect(b.sessionsOpened()).toBe(0);
  });
});

describe("loadJudgeItem", () => {
  const dirs: string[] = [];
  afterEach(async () => { await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });

  it("builds the item from frontmatter + 상세 요약 only (no excerpts, source or paths)", async () => {
    const d = await mkTmp(); dirs.push(d);
    const cand = { path: "/SECRETDIR/a.md", key: "/SECRETDIR/a.md", format: "md" as const, size: 1, mtimeMs: 0, hash: "sha256:abcdef00", duplicates: ["/SECRETDIR/b.md"] };
    const { relPath } = await writeFileCard(d, cand, {
      id: "f1", type: "보고서", use_for: ["자소서"], title: "제목", summary: "요약", detail: "상세 1\n상세 2",
      excerpts: ["EXCERPT-원문 문장"], period: "2024-01 ~ 2024-02", role: "팀장", skills: ["Go"], metrics: ["50% 개선"], org: "동아리", in_resume: "판단불가",
    }, "claude");
    const item = await loadJudgeItem(d, relPath, "c7");
    expect(item).toEqual({
      id: "c7", card: relPath,
      fields: { type: "보고서", use_for: ["자소서"], title: "제목", summary: "요약", period: "2024-01 ~ 2024-02", role: "팀장", skills: ["Go"], metrics: ["50% 개선"], org: "동아리", detail: "상세 1\n상세 2" },
    });
    const p = buildJudgePrompt([item!]);
    expect(p).not.toContain("EXCERPT");
    expect(p).not.toContain("SECRETDIR");
    expect(p).not.toContain("sha256");
  });

  it("returns null for an unreadable or invalid card", async () => {
    const d = await mkTmp(); dirs.push(d);
    await mkdir(join(d, "files"));
    await writeFile(join(d, "files", "x.md"), "---\na: [\n---\n");
    expect(await loadJudgeItem(d, "files/x.md", "c1")).toBeNull();
    expect(await loadJudgeItem(d, "files/none.md", "c1")).toBeNull();
    expect(await readFile(join(d, "files", "x.md"), "utf8")).toContain("a: [");
  });
});
