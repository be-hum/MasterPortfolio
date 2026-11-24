import { describe, it, expect } from "vitest";
import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { mkTmp } from "../helpers/tmp.js";
import { emptyState } from "../../src/store/state.js";
import { createExperience, listExperiences } from "../../src/store/experiences.js";
import { applyReviews, applyTargets, buildApplyPrompt, mergeApply } from "../../src/analyzer/reviewApply.js";
import { ApplyResult } from "../../src/analyzer/reviewApply.js";
import type { ExperienceFrontmatter } from "../../src/core/schema.js";

const fm = (over: Partial<ExperienceFrontmatter> = {}): ExperienceFrontmatter => ({
  schema_version: 1, kind: "experience", title: "캡스톤", type: "보고서", period: "2025-03 ~ 2025-06", org: null, role: null, team_size: null, contribution: null, category: null,
  skills: ["Python"], metrics: [], value: "중", value_reason: null, evidence: ["files/a.md"], in_resume: "판단불가", review: "adopted",
  questions: [{ id: "q1", field: "role", q: "본인 역할은?", a: "팀장 010-1234-5678" }], pending_apply: true, reviewed_at: "x", agent: "claude", generated_at: "x", ...over,
});

const okBridge = (reply: (text: string) => string) => ({
  newSession: async () => "s",
  prompt: async (_s: string, text: string) => ({ ok: true as const, text: reply(text) }),
});

describe("apply (11.2 반영)", () => {
  it("prompt carries masked Q/A and no evidence paths", async () => {
    const out = await mkTmp(); const st = emptyState();
    await createExperience(out, st, fm());
    const [e] = await listExperiences(out, st);
    const p = buildApplyPrompt([{ id: "x1", exp: e }]);
    expect(p).toContain("본인 역할은?");
    expect(p).toContain("[전화번호]");
    expect(p).not.toContain("010-1234-5678");
    expect(p).not.toContain("files/a.md");
  });

  it("tags Q with its field and carries contribution rules", async () => {
    const out = await mkTmp(); const st = emptyState();
    await createExperience(out, st, fm());
    const [e] = await listExperiences(out, st);
    const p = buildApplyPrompt([{ id: "x1", exp: e }]);
    expect(p).toContain("Q[role]: 본인 역할은?");
    expect(p).toContain('"contribution":null');
    expect(p).toContain('"contribution":"AI 주도","category":"대회·CTF"');
    expect(p).toContain("- contribution(수행 방식)은 답변에 근거해 다음 중 하나로 분류하세요");
    expect(p).toContain("- role과 star의 a(Action)는 본인이 직접 한 일과 도움받은 부분(강의·팀원·AI)을 구분해 쓰세요.");
    expect(p).toContain("- metrics는 결과·성과입니다. 문서 통계(슬라이드 장수, 파일·페이지·참고자료 개수)는 쓰지 마세요.");
  });

  it("drops only an out-of-enum contribution and merges valid ones", () => {
    const star = { s: "a", t: "b", a: "c", r: "d" };
    const r = ApplyResult.parse({ id: "x1", contribution: "엉터리", category: "연구", star });
    expect(r.contribution).toBeUndefined();
    expect(r.category).toBe("연구");
    const m = mergeApply(fm(), ApplyResult.parse({ id: "x1", contribution: "AI 주도", category: "연구", star }));
    expect(m.contribution).toBe("AI 주도");
    expect(m.category).toBe("연구");
  });

  it("mergeApply ignores a period without a year (e.g. answer \"맞음\")", () => {
    const m = mergeApply(fm({ period: "2021-06 ~ 2021-08" }), ApplyResult.parse({ id: "x1", period: "맞음", star: { s: "a", t: "b", a: "c", r: "d" } }));
    expect(m.period).toBe("2021-06 ~ 2021-08");
  });

  it("mergeApply only replaces provided fields and clears pending_apply", () => {
    const m = mergeApply(fm(), { id: "x1", role: "팀장", period: null, star: { s: "a", t: "b", a: "c", r: "d" } } as any);
    expect(m.role).toBe("팀장");
    expect(m.period).toBe("2025-03 ~ 2025-06");
    expect(m.pending_apply).toBe(false);
  });

  it("writes fields and STAR, and skips a card edited after loading (Review Focus 1)", async () => {
    const out = await mkTmp(); const st = emptyState();
    const a = await createExperience(out, st, fm({ title: "A" }));
    const b = await createExperience(out, st, fm({ title: "B" }));
    const targets = applyTargets(await listExperiences(out, st));
    await appendFile(join(out, b), "\n사용자 메모\n");
    const applied: string[] = [], skipped: string[] = [];
    const r = await applyReviews(okBridge((t) => JSON.stringify([...t.matchAll(/<<<EXP id=(\S+) /g)].map((m) => ({ id: m[1], role: "팀장", star: { s: "S", t: "T", a: "A", r: "R" } })))) as any,
      out, st, targets.map((exp, i) => ({ id: `x${i + 1}`, exp })), { timeoutMs: 1000, onApplied: (r) => applied.push(r), onSkipped: (r) => skipped.push(r) });
    expect(r.stopped).toBeNull();
    expect(applied).toEqual([a]);
    expect(skipped).toEqual([b]);
    const text = await readFile(join(out, a), "utf8");
    expect(text).toContain("- Situation: S");
    expect(text).toContain("role: 팀장");
    expect(await readFile(join(out, b), "utf8")).toContain("사용자 메모");
    const after = await listExperiences(out, st);
    expect(after.find((e) => e.rel === a)!.fm.pending_apply).toBe(false);
  });

  it("applyTargets takes only adopted/held cards with unapplied answers", async () => {
    const out = await mkTmp(); const st = emptyState();
    await createExperience(out, st, fm({ title: "A", review: "excluded" }));
    await createExperience(out, st, fm({ title: "B", pending_apply: false }));
    await createExperience(out, st, fm({ title: "C", review: "pending" }));
    await createExperience(out, st, fm({ title: "D", review: "held" }));
    expect(applyTargets(await listExperiences(out, st)).map((e) => e.fm.title)).toEqual(["D"]);
  });
});
