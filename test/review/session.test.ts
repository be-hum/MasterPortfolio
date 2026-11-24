import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { mkTmp } from "../helpers/tmp.js";
import { emptyState, loadState } from "../../src/store/state.js";
import { createExperience, listExperiences } from "../../src/store/experiences.js";
import { decisionTargets, questionTargets, runReviewSession, type ReviewIO } from "../../src/review/session.js";
import { applyTargets } from "../../src/analyzer/reviewApply.js";
import type { ExperienceFrontmatter } from "../../src/core/schema.js";

const fm = (title: string, over: Partial<ExperienceFrontmatter> = {}): ExperienceFrontmatter => ({
  schema_version: 1, kind: "experience", title, type: "보고서", period: null, org: null, role: null, team_size: null, contribution: null, category: null,
  skills: [], metrics: [], value: "상", value_reason: null, evidence: ["files/a.md"], in_resume: "판단불가", review: "pending",
  questions: [{ id: "q1", field: "role", q: "본인 역할은?", a: null }, { id: "q2", field: "metrics", q: "성과는?", a: null }],
  pending_apply: false, reviewed_at: null, agent: "claude", generated_at: "x", ...over,
});
type Pick = { adopted?: string[]; excluded?: string[] } | null;
const io = (answers: (string | null)[], picks: Pick[]): ReviewIO & { shown: string[]; labels: string[][] } => {
  const shown: string[] = []; const labels: string[][] = [];
  return {
    shown, labels, show: (t) => shown.push(t), answer: async () => (answers.length ? answers.shift()! : null),
    decideMany: async (items) => {
      labels.push(items.map((i) => i.label));
      const p = picks.length ? picks.shift()! : null;
      return p === null ? null : { adopted: new Set(p.adopted ?? items.map((i) => i.rel)), excluded: new Set(p.excluded ?? []) };
    },
  };
};
const run = async (out: string, st: Parameters<typeof runReviewSession>[1], i: ReviewIO, all = false) =>
  runReviewSession(out, st, await listExperiences(out, st), all, i);

describe("review targets (11.4)", () => {
  it("decision targets are pending/held non-edited cards, skipping 하 unless all; question targets are adopted with unanswered", async () => {
    const out = await mkTmp(); const st = emptyState();
    await createExperience(out, st, fm("A"));
    await createExperience(out, st, fm("B", { value: "하" }));
    await createExperience(out, st, fm("C", { review: "excluded" }));
    await createExperience(out, st, fm("D", { review: "adopted", questions: [{ id: "q1", field: "role", q: "?", a: "팀장" }] }));
    await createExperience(out, st, fm("E", { review: "held" }));
    await createExperience(out, st, fm("F", { review: "adopted" }));
    const exps = await listExperiences(out, st);
    expect(decisionTargets(exps, false).map((e) => e.fm.title).sort()).toEqual(["A", "E"]);
    expect(decisionTargets(exps, true).map((e) => e.fm.title).sort()).toEqual(["A", "B", "E"]);
    expect(questionTargets(exps).map((e) => e.fm.title)).toEqual(["F"]);
  });
});

describe("runReviewSession (decide first)", () => {
  it("decides in bulk; unpicked are held; only adopted cards get questions; labels follow the format", async () => {
    const out = await mkTmp(); const st = emptyState();
    const a = await createExperience(out, st, fm("A", { period: "2025-03" }));
    const b = await createExperience(out, st, fm("B"));
    const c = await createExperience(out, st, fm("C", { value: null }));
    const i = io(["팀장", "1등"], [{ adopted: [a], excluded: [b] }]);
    let asked = 0; const orig = i.answer; i.answer = async (q) => { asked++; return orig(q); };
    const r = await run(out, st, i);
    expect(r).toEqual({ answered: 2, decided: 3, quit: false });
    expect(asked).toBe(2);
    expect(i.labels[0]).toEqual(["1. A — 2025-03 · 근거 1개 · 가치 상", "2. B — 기간 미상 · 근거 1개 · 가치 상", "3. C — 기간 미상 · 근거 1개 · 가치 미판정"]);
    const m = new Map((await listExperiences(out, st)).map((e) => [e.rel, e]));
    expect(m.get(a)!.fm.review).toBe("adopted");
    expect(m.get(b)!.fm.review).toBe("excluded");
    expect(m.get(c)!.fm.review).toBe("held");
    expect(m.get(a)!.fm.pending_apply).toBe(true);
  });

  it("masks answers before storing (Review Focus 2)", async () => {
    const out = await mkTmp(); const st = emptyState();
    const rel = await createExperience(out, st, fm("A"));
    const r = await run(out, st, io(["팀장, 연락처 010-1234-5678", "모름"], [{}]));
    expect(r).toEqual({ answered: 2, decided: 1, quit: false });
    const text = await readFile(join(out, rel), "utf8");
    expect(text).toContain("[전화번호]");
    expect(text).not.toContain("010-1234-5678");
    const [e] = await listExperiences(out, st);
    expect(e.fm.questions.map((q) => q.a)).toEqual(["팀장, 연락처 [전화번호]", "모름"]);
  });

  it("quitting at decideMany (null) changes nothing", async () => {
    const out = await mkTmp(); const st = emptyState();
    const rel = await createExperience(out, st, fm("A"));
    const before = await readFile(join(out, rel), "utf8");
    const r = await run(out, st, io(["x"], [null]));
    expect(r).toEqual({ answered: 0, decided: 0, quit: true });
    expect(await readFile(join(out, rel), "utf8")).toBe(before);
  });

  it("held cards are decision targets again next run", async () => {
    const out = await mkTmp(); const st = emptyState();
    const rel = await createExperience(out, st, fm("A"));
    await run(out, st, io([], [{ adopted: [] }]));
    expect((await listExperiences(out, st))[0].fm.review).toBe("held");
    const i2 = io(["", ""], [{ adopted: [rel] }]);
    await run(out, st, i2);
    expect(i2.labels).toHaveLength(1);
    expect((await listExperiences(out, st))[0].fm.review).toBe("adopted");
  });

  it("keeps answers given before quitting and resumes at the first unanswered question (Review Focus 3)", async () => {
    const out = await mkTmp(); const st = emptyState();
    await createExperience(out, st, fm("A", { review: "adopted" }));
    const first = await run(out, st, io(["팀장", null], []));
    expect(first.quit).toBe(true);
    let [e] = await listExperiences(out, st);
    expect(e.fm.questions.map((q) => q.a)).toEqual(["팀장", null]);
    const asked: string[] = [];
    const io2 = io(["3명 중 1등"], []);
    const orig = io2.answer; io2.answer = async (q) => { asked.push(q); return orig(q); };
    await run(out, st, io2);
    expect(asked).toEqual(["성과는?"]);
  });

  it("an interrupted session (answer() throws) leaves the answered card un-edited on disk and resumable (C1)", async () => {
    const out = await mkTmp(); const st = emptyState();
    await createExperience(out, st, fm("A", { review: "adopted" }));
    let n = 0;
    const boom: ReviewIO = { show: () => {}, answer: async () => { if (n++ === 0) return "팀장"; throw new Error("killed"); }, decideMany: async () => null };
    await expect(run(out, st, boom)).rejects.toThrow("killed");
    const disk = (await loadState(out)).state;
    const [e] = await listExperiences(out, disk);
    expect(e.edited).toBe(false);
    expect(e.fm.questions.map((q) => q.a)).toEqual(["팀장", null]);
  });

  it("skipped answers stay null and leave nothing to apply", async () => {
    const out = await mkTmp(); const st = emptyState();
    await createExperience(out, st, fm("A"));
    await run(out, st, io(["", ""], [{}]));
    const [e] = await listExperiences(out, st);
    expect(e.fm.review).toBe("adopted");
    expect(e.fm.pending_apply).toBe(false);
    expect(e.fm.questions.every((q) => q.a === null)).toBe(true);
  });

  it("an excluded card is never applied (I1) and gets no questions", async () => {
    const out = await mkTmp(); const st = emptyState();
    await createExperience(out, st, fm("A"));
    const i = io(["팀장"], []);
    const exps = await listExperiences(out, st);
    i.decideMany = async () => ({ adopted: new Set(), excluded: new Set([exps[0].rel]) });
    let asked = 0; i.answer = async () => { asked++; return ""; };
    await runReviewSession(out, st, exps, false, i);
    expect(asked).toBe(0);
    expect((await listExperiences(out, st))[0].fm.review).toBe("excluded");
    expect(applyTargets(await listExperiences(out, st))).toEqual([]);
  });
});
