import { describe, it, expect } from "vitest";
import { ensureBaseQuestions, evidenceModified, CONTRIBUTION_Q } from "../../src/review/baseQuestions.js";
import { emptyState } from "../../src/store/state.js";
import type { ExperienceFrontmatter } from "../../src/core/schema.js";

const fm = (o: Partial<ExperienceFrontmatter> = {}): ExperienceFrontmatter => ({
  schema_version: 1, kind: "experience", title: "A", type: "보고서", period: "2021-06 ~ 2021-08", org: null, role: null, team_size: null,
  contribution: null, category: null, skills: [], metrics: [], value: "중", value_reason: null, evidence: ["files/a.md"], in_resume: "판단불가",
  review: "pending", questions: [], pending_apply: false, reviewed_at: null, agent: "claude", generated_at: "2026-11-24T10:00:00+09:00", ...o,
});

describe("ensureBaseQuestions (11.4)", () => {
  it("adds contribution question once, idempotently", () => {
    const a = ensureBaseQuestions(fm(), []);
    expect(a.questions).toEqual([{ id: "q1", field: "contribution", q: CONTRIBUTION_Q, a: null }]);
    expect(ensureBaseQuestions(a, [])).toBe(a);
  });
  it("skips contribution when already set", () => {
    const f = fm({ contribution: "AI 주도" });
    expect(ensureBaseQuestions(f, [])).toBe(f);
  });
  it("asks for the period when null, with file dates when known", () => {
    const a = ensureBaseQuestions(fm({ period: null, contribution: "AI 보조" }), ["2026-10", "2026-11"]);
    expect(a.questions[0].q).toContain("근거 파일 수정일: 2026-10 ~ 2026-11");
    const b = ensureBaseQuestions(fm({ period: null, contribution: "AI 보조" }), []);
    expect(b.questions[0].q).toBe("실제로 진행한 시기(시작~종료 연월)는 언제인가요?");
    const c = ensureBaseQuestions(fm({ period: null, contribution: "AI 보조" }), ["2026-10"]);
    expect(c.questions[0].q).toContain("근거 파일 수정일: 2026-10,");
  });
  it("confirms the period when file dates do not overlap its years", () => {
    const a = ensureBaseQuestions(fm({ contribution: "AI 보조" }), ["2026-10"]);
    expect(a.questions[0].q).toContain("카드 기간은 2021-06 ~ 2021-08, 근거 파일 수정일은 2026-10입니다");
    const f = fm({ contribution: "AI 보조" });
    expect(ensureBaseQuestions(f, ["2021-07"])).toBe(f);
  });
  it("does not ask the period when a period question exists", () => {
    for (const a of ["2021-05", null]) {
      const f = fm({ period: null, contribution: "AI 보조", questions: [{ id: "q1", field: "period", q: "언제?", a }] });
      expect(ensureBaseQuestions(f, ["2026-10"])).toBe(f);
    }
  });
  it("numbers new ids after existing questions", () => {
    const f = fm({ period: null, questions: [{ id: "q1", field: "role", q: "a", a: null }, { id: "q2", field: "org", q: "b", a: null }] });
    expect(ensureBaseQuestions(f, []).questions.map((q) => q.id)).toEqual(["q1", "q2", "q3", "q4"]);
  });
});

describe("question ids", () => {
  it("continue after the largest existing number even with gaps", () => {
    const r = ensureBaseQuestions(fm({ questions: [{ id: "q1", field: "role", q: "r", a: null }, { id: "q3", field: "metrics", q: "m", a: null }], period: null }), []);
    expect(r.questions.map((q) => q.id)).toEqual(["q1", "q3", "q4", "q5"]);
  });
});

describe("evidenceModified", () => {
  it("collects sorted unique year-months of evidence cards", () => {
    const st = emptyState();
    const ent = (card: string, modified: string) => ({ source_hash: "h", card, card_body_hash: "b", card_snapshot: { modified }, status: "ok" }) as never;
    st.files = { x: ent("files/a.md", "2026-11-03"), y: ent("files/b.md", "2026-10-27"), z: ent("files/c.md", "2026-11-20"), w: ent("files/d.md", "2020-01-01") };
    expect(evidenceModified(st, ["files/a.md", "files/b.md", "files/c.md", "files/none.md"])).toEqual(["2026-10", "2026-11"]);
  });
});
