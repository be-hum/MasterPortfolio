import { describe, it, expect } from "vitest";
import { mkTmp } from "../helpers/tmp.js";
import { emptyState } from "../../src/store/state.js";
import { createExperience, listExperiences } from "../../src/store/experiences.js";
import { buildKeywordsPrompt, clampKeywords, generateKeywords, KEYWORDS_MARKER } from "../../src/analyzer/keywords.js";
import { ExperienceFrontmatter } from "../../src/core/schema.js";

const fm = (over: Record<string, unknown> = {}) => ExperienceFrontmatter.parse({
  schema_version: 1, kind: "experience", title: "캡스톤", type: "보고서", period: "2025-03 ~ 2025-06", org: null, role: "팀장 010-1234-5678", team_size: null,
  skills: ["Python"], metrics: [], value: "중", value_reason: null, evidence: ["files/a.md"], in_resume: "판단불가", review: "adopted",
  questions: [], reviewed_at: null, agent: "claude", generated_at: "x", ...over,
});
const bridge = (replies: string[]) => ({
  newSession: async () => "s",
  prompt: async () => ({ ok: true as const, text: replies.shift() ?? "" }),
});

describe("clampKeywords", () => {
  it("handles non-arrays, length, dupes, blanks and max", () => {
    expect(clampKeywords("x", 3)).toEqual([]);
    expect(clampKeywords(["a".repeat(20)], 3)).toEqual(["a".repeat(18)]);
    expect(clampKeywords(["AES-CBC·CTR 개념 해석 및 검증"], 3)).toEqual(["AES-CBC·CTR 개념 해석"]);
    expect(clampKeywords(["DLL 140,800바이트 복원 완료"], 3)).toEqual(["DLL 140,800바이트 복원"]);
    expect(clampKeywords([" 가 ", "가", "", 1, "나", "다", "라"], 3)).toEqual(["가", "나", "다"]);
  });
});

describe("keywords stage", () => {
  it("masks the prompt", async () => {
    const out = await mkTmp(); const st = emptyState();
    await createExperience(out, st, fm());
    const [e] = await listExperiences(out, st);
    const p = buildKeywordsPrompt([{ id: "k1", exp: e }]);
    expect(p.startsWith(KEYWORDS_MARKER)).toBe(true);
    expect(p).toContain("[전화번호]");
    expect(p).not.toContain("010-1234-5678");
  });

  it("retries garbage then saves", async () => {
    const out = await mkTmp(); const st = emptyState();
    await createExperience(out, st, fm());
    const [e] = await listExperiences(out, st);
    const saved: string[] = [];
    const b = bridge(["모르겠습니다", JSON.stringify([{ id: "k1", keywords: ["a", "b"], outcome_keywords: ["c"] }])]);
    const r = await generateKeywords(b, out, st, [{ id: "k1", exp: e }], { timeoutMs: 5000, onSaved: (x) => saved.push(x), onSkipped: () => {} });
    expect(r.stopped).toBeNull();
    expect(saved).toHaveLength(1);
    const [g] = await listExperiences(out, st);
    expect(g.fm.keywords).toEqual(["a", "b"]);
    expect(g.fm.outcome_keywords).toEqual(["c"]);
  });

  it("old cards without keys parse to []", () => {
    const f = fm();
    expect(f.keywords).toEqual([]); expect(f.outcome_keywords).toEqual([]);
  });
});

describe("apply keywords", () => {
  it("ApplyResult clamps keywords and mergeApply applies them", async () => {
    const { ApplyResult, mergeApply } = await import("../../src/analyzer/reviewApply.js");
    const r = ApplyResult.parse({ id: "x1", keywords: ["가", "가", "나"], outcome_keywords: [], star: { s: "", t: "", a: "", r: "" } });
    expect(r.keywords).toEqual(["가", "나"]);
    expect(r.outcome_keywords).toBeUndefined();
    expect(mergeApply(fm(), r).keywords).toEqual(["가", "나"]);
  });
});
