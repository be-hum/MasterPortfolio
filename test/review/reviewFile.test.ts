import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { mkTmp } from "../helpers/tmp.js";
import { emptyState } from "../../src/store/state.js";
import { createExperience, listExperiences } from "../../src/store/experiences.js";
import { writeReviewFile, parseReviewFile, applyReviewFile } from "../../src/review/reviewFile.js";
import { decisionTargets, questionTargets } from "../../src/review/session.js";
import type { ExperienceFrontmatter } from "../../src/core/schema.js";

const fm = (title: string, over: Partial<ExperienceFrontmatter> = {}): ExperienceFrontmatter => ({
  schema_version: 1, kind: "experience", title, type: "보고서", period: null, org: null, role: null, team_size: null, contribution: null, category: null,
  skills: [], metrics: [], value: "상", value_reason: null, evidence: ["files/a.md"], in_resume: "판단불가", review: "pending",
  questions: [{ id: "q1", field: "role", q: "본인 역할은?", a: null }, { id: "q2", field: "metrics", q: "성과는?", a: null }],
  pending_apply: false, reviewed_at: null, agent: "claude", generated_at: "x", ...over,
});

describe("review.md (11.2 --file / --apply)", () => {
  it("round-trips answers (multi-line) and decisions", async () => {
    const out = await mkTmp(); const st = emptyState();
    const rel = await createExperience(out, st, fm("A"));
    const exps = await listExperiences(out, st);
    const path = await writeReviewFile(out, decisionTargets(exps, false), [exps[0]]);
    const filled = (await readFile(path, "utf8"))
      .replace("### q1 (role) 본인 역할은?\nA:", "### q1 (role) 본인 역할은?\nA: 팀장\n모델 학습 담당")
      .replace(/결정:\s*$/m, "결정: 채택");
    const r = await applyReviewFile(out, st, filled);
    expect(r).toEqual({ applied: [rel], problems: [], newlyAdoptedWithQuestions: 1 });
    const [e] = await listExperiences(out, st);
    expect(e.fm.questions[0].a).toBe("팀장 모델 학습 담당");
    expect(e.fm.questions[1].a).toBeNull();
    expect(e.fm.review).toBe("adopted");
    expect(e.fm.pending_apply).toBe(true);
  });

  it("skips bad sections and reports them without crashing (Review Focus 5)", async () => {
    const out = await mkTmp(); const st = emptyState();
    const rel = await createExperience(out, st, fm("A"));
    const text = [
      "# MasterPortfolio 질의응답", "",
      "## experiences/없는카드.md", "### q1 (role) ?", "A: x", "결정: 채택", "",
      `## ${rel}`, "아무 말", "### q9 (role) 없는 질문", "A: y", "결정: 최고", "",
    ].join("\n");
    const r = await applyReviewFile(out, st, text);
    expect(r.applied).toEqual([]);
    expect(r.problems.join("\n")).toContain("없는카드");
    expect(r.problems.join("\n")).toContain("q9");
    expect(r.problems.join("\n")).toContain("최고");
    expect(parseReviewFile("쓰레기").sections).toEqual([]);
  });

  it("writes a decision part without questions and a question part without decisions", async () => {
    const out = await mkTmp(); const st = emptyState();
    await createExperience(out, st, fm("A"));
    await createExperience(out, st, fm("B", { review: "adopted" }));
    const exps = await listExperiences(out, st);
    const text = await readFile(await writeReviewFile(out, decisionTargets(exps, false), questionTargets(exps)), "utf8");
    const i1 = text.indexOf("# 1. 결정"), i2 = text.indexOf("# 2. 질문");
    expect(i1).toBeGreaterThan(0); expect(i2).toBeGreaterThan(i1);
    const head = text.slice(0, i1), d = text.slice(i1, i2), q = text.slice(i2);
    expect(head).toContain("결정 절의 `결정:` 뒤에");
    expect(d).toMatch(/^결정:/m); expect(d).not.toContain("### q");
    expect(q).toContain("### q1 (role)"); expect(q).not.toMatch(/^결정:/m);
    const only = await readFile(await writeReviewFile(out, [], questionTargets(exps)), "utf8");
    expect(only).not.toContain("# 1. 결정");
    expect(parseReviewFile(only).sections).toHaveLength(1);
    const onlyD = await readFile(await writeReviewFile(out, decisionTargets(exps, false), []), "utf8");
    expect(onlyD).not.toContain("# 2. 질문");
    expect(parseReviewFile(onlyD).sections).toHaveLength(1);
  });

  it("merges a card appearing in both parts", () => {
    const t = ["# 1. 결정", "## experiences/a.md", "결정: 채택", "", "# 2. 질문", "## experiences/a.md", "### q1 (role) ?", "A: 팀장", ""].join("\n");
    const { sections } = parseReviewFile(t);
    expect(sections).toEqual([{ rel: "experiences/a.md", answers: { q1: "팀장" }, decision: "adopted" }]);
  });
});
