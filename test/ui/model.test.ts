import { describe, it, expect } from "vitest";
import { adoptedOnly, buildUiState } from "../../src/ui/model.js";
import type { LoadedExperience } from "../../src/store/experiences.js";
import type { ExperienceFrontmatter } from "../../src/core/schema.js";

const exp = (title: string, over: Partial<ExperienceFrontmatter> = {}, edited = false): LoadedExperience => ({
  rel: `experiences/${title}.md`, body: "", edited, star: null,
  fm: {
    schema_version: 1, kind: "experience", title, type: "보고서", period: null, org: null, role: null, team_size: null, contribution: null, category: null,
    keywords: ["k"], outcome_keywords: ["o"], skills: [], metrics: [], value: "상", value_reason: null, evidence: ["files/a.md"], in_resume: "판단불가",
    review: "adopted", questions: [{ id: "q1", field: "role", q: "역할?", a: null }], pending_apply: true, reviewed_at: null, agent: "claude", generated_at: "x", ...over,
  },
});

describe("buildUiState (11.5)", () => {
  it("includes every review state and the UI-only fields", () => {
    const r = buildUiState([exp("a"), exp("b", { review: "excluded" }), exp("c", { review: "held" }, true), exp("d", { review: "pending" })], new Map());
    expect(r.map((x) => x.review)).toEqual(["adopted", "excluded", "held", "pending"]);
    expect(r[2].edited).toBe(true);
    expect(r[0]).toMatchObject({ pending_apply: true, keywords: ["k"], outcome_keywords: ["o"], value: "상", questions: [{ id: "q1", field: "role", q: "역할?", a: null }] });
  });
  it("infers category (with evidence titles), collapses period, filters doc-stat metrics", () => {
    const [x, y] = buildUiState([
      exp("해킹 팀", { period: "2025-03 ~ 2025-03", metrics: ["슬라이드 12장", "정확도 92%"], role: "팀장", team_size: 3 }),
      exp("동아리 활동", {}),
    ], new Map([["files/a.md", "CTF write-up"]]));
    expect(x.category).toBe("대회·CTF");
    expect(x.period).toBe("2025-03");
    expect(x.metrics).toEqual(["정확도 92%"]);
    expect(x.role).toBe("팀장 (팀 3명)");
    expect(y.category).toBe("대회·CTF");
    const [z] = buildUiState([exp("동아리 활동")], new Map());
    expect(z.category).toBe("동아리·스터디");
    expect(x.raw).toEqual({ period: "2025-03 ~ 2025-03", role: "팀장", team_size: 3, category: null, metrics: ["슬라이드 12장", "정확도 92%"] });
  });
  it("adoptedOnly keeps adopted experiences without Q/A", () => {
    const r = adoptedOnly(buildUiState([exp("a"), exp("b", { review: "held" })], new Map()));
    expect(r.map((e) => e.title)).toEqual(["a"]);
    expect(r[0].questions).toEqual([]);
  });
});
