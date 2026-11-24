import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { mkTmp } from "../helpers/tmp.js";
import { seedCards } from "../helpers/cards.js";
import { runGroup } from "../../src/commands/group.js";
import { runReview } from "../../src/commands/review.js";
import { listExperiences, saveExperience } from "../../src/store/experiences.js";
import { loadState } from "../../src/store/state.js";
import type { ReviewIO } from "../../src/review/session.js";

const dirs: string[] = [];
const scripted = (answers: (string | null)[], decisions: ("adopted" | "held" | "excluded" | null)[]): ReviewIO => ({
  show: () => {}, answer: async () => (answers.length ? answers.shift()! : null), decideMany: async (items) => {
    const d = decisions.length ? decisions.shift()! : null;
    if (d === null) return null;
    const rels = new Set(items.map((i) => i.rel));
    return { adopted: new Set(d === "adopted" ? rels : []), excluded: new Set(d === "excluded" ? rels : []) };
  },
});

describe("runReview (11.2)", () => {
  beforeEach(() => { vi.spyOn(console, "log").mockImplementation(() => {}); });
  afterEach(async () => { vi.restoreAllMocks(); delete process.env.MP_OUTPUT_DIR; await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });

  async function grouped(scenario = "group-one") {
    const out = await mkTmp("mp-out-"); dirs.push(out); process.env.MP_OUTPUT_DIR = out;
    const log = await seedCards(out, [{ title: "보고서" }, { title: "발표" }], scenario);
    await runGroup({ yes: true });
    return { out, log };
  }

  it("asks, stores masked answers, applies with the judge model, and writes STAR", async () => {
    const { out, log } = await grouped();
    const r = await runReview({ yes: true, logPrompts: true, io: scripted(["팀장 010-1234-5678", "정확도 92%", "", ""], ["adopted"]) });
    expect(r.code).toBe(0);
    expect(r.applied).toHaveLength(1);
    const { state } = await loadState(out);
    const [e] = await listExperiences(out, state);
    expect(e.fm.pending_apply).toBe(false);
    expect(e.fm.role).toBe("팀장 [전화번호]");
    expect(e.fm.metrics).toEqual(["정확도 92%"]);
    expect(e.body).toContain("- Situation: 상황");
    const prompts = await readFile(log, "utf8");
    expect(prompts).toContain('"stage":"apply"');
    expect(prompts).not.toContain("010-1234-5678");
  });

  it("puts each answer into its own field; 모름 leaves the seed value (11.4)", async () => {
    const { out } = await grouped();
    const r = await runReview({ yes: true, io: scripted(["팀장", "모름", "AI가 대부분 하고 검증만", ""], ["adopted"]) });
    expect(r.applied).toHaveLength(1);
    const { state } = await loadState(out);
    const [e] = await listExperiences(out, state);
    expect(e.fm.role).toBe("팀장");
    expect(e.fm.contribution).toBe("AI 주도");
    expect(e.fm.metrics).toEqual([]);
  });

  it("--file decides first, --apply announces the newly adopted card, a second --file asks its questions", async () => {
    const { out } = await grouped();
    const logSpy = vi.mocked(console.log);
    logSpy.mockClear();
    expect((await runReview({ file: true })).code).toBe(0);
    const path = join(out, "review.md");
    const note = `review.md에는 마스킹 전 답변이 남아 있습니다. 반영이 끝났으면 지워도 됩니다: ${path}`;
    const t1 = await readFile(path, "utf8");
    expect(t1).toContain("# 1. 결정");
    expect(t1).not.toContain("# 2. 질문");
    expect(t1).not.toContain("### q");
    expect(logSpy.mock.calls.map((c) => String(c[0]))).toContain(note);
    await writeFile(path, t1.replace(/결정:\s*$/m, "결정: 채택"));
    logSpy.mockClear();
    const r1 = await runReview({ apply: true, yes: true });
    expect(r1.applied).toEqual([]);
    expect(logSpy.mock.calls.map((c) => String(c[0]))).toContain("새로 채택한 경험 1개에 질문이 있습니다. `mp review --file`을 다시 실행하세요.");
    await runReview({ file: true });
    const t2 = await readFile(path, "utf8");
    expect(t2).toContain("# 2. 질문");
    expect(t2).not.toContain("# 1. 결정");
    expect(t2).not.toMatch(/^결정:/m);
    await writeFile(path, t2.replace(/^A:\s*$/m, "A: 팀장"));
    logSpy.mockClear();
    const r2 = await runReview({ apply: true, yes: true });
    expect(r2.applied).toHaveLength(1);
    expect(logSpy.mock.calls.map((c) => String(c[0]))).toContain(note);
  });

  it("quitting at the bulk decision leaves every card unchanged (hash and review)", async () => {
    const { out } = await grouped();
    const { state } = await loadState(out);
    const [e] = await listExperiences(out, state);
    const before = await readFile(join(out, e.rel), "utf8");
    const r = await runReview({ yes: true, io: scripted(["팀장"], [null]) });
    expect(r.applied).toEqual([]);
    expect(await readFile(join(out, e.rel), "utf8")).toBe(before);
    expect(e.fm.review).toBe("pending");
  });

  it("held cards are asked to be decided again on the next run; questions only for adopted", async () => {
    const { out } = await grouped();
    let answered = 0;
    const io = (d: "held" | "adopted"): ReviewIO => ({ ...scripted(["", "", "", ""], [d]), answer: async () => { answered++; return ""; } });
    await runReview({ yes: true, io: io("held") });
    expect(answered).toBe(0);
    await runReview({ yes: true, io: io("adopted") });
    expect(answered).toBe(4);
  });

  it("migrates old cards: adds the contribution question once, however often review runs", async () => {
    const { out } = await grouped();
    const { state } = await loadState(out);
    const [e] = await listExperiences(out, state);
    await saveExperience(out, state, e, { ...e.fm, questions: e.fm.questions.filter((q) => q.field !== "contribution") });
    const count = async () => {
      const { state: s } = await loadState(out);
      return (await listExperiences(out, s))[0].fm.questions.filter((q) => q.field === "contribution").length;
    };
    const none = { yes: true, io: scripted([], [null]) };
    await runReview(none);
    expect(await count()).toBe(1);
    await runReview({ yes: true, io: scripted([], [null]) });
    expect(await count()).toBe(1);
  });

  it("keeps answers when the apply step hits a rate limit and applies them next time", async () => {
    const out = await mkTmp("mp-out-"); dirs.push(out); process.env.MP_OUTPUT_DIR = out;
    await seedCards(out, [{ title: "보고서" }], "group-one");
    await runGroup({ yes: true });
    const cfgPath = join(out, ".mp", "config.json");
    const cfg = JSON.parse(await readFile(cfgPath, "utf8"));
    cfg.agents.claude.env.FAKE_AGENT_SCENARIO = "apply-rate-limit";
    await writeFile(cfgPath, JSON.stringify(cfg));
    const r1 = await runReview({ yes: true, io: scripted(["팀장", "", "", ""], ["adopted"]) });
    expect(r1.code).toBe(3);
    let { state } = await loadState(out);
    let [e] = await listExperiences(out, state);
    expect(e.fm.pending_apply).toBe(true);
    expect(e.fm.questions[0].a).toBe("팀장");
    cfg.agents.claude.env.FAKE_AGENT_SCENARIO = "ok";
    await writeFile(cfgPath, JSON.stringify(cfg));
    const r2 = await runReview({ yes: true, io: scripted([], []) });
    expect(r2.applied).toHaveLength(1);
  });

  it("quitting at the decision stores nothing; a later run adopts, asks and applies (I1)", async () => {
    const { out } = await grouped();
    const r1 = await runReview({ yes: true, io: scripted(["팀장"], [null]) });
    expect(r1.applied).toEqual([]);
    const r2 = await runReview({ yes: true, io: scripted(["팀장", "정확도 92%", "", ""], ["adopted"]) });
    expect(r2.applied).toHaveLength(1);
    const { state } = await loadState(out);
    const [e] = await listExperiences(out, state);
    expect(e.fm.pending_apply).toBe(false);
    expect(e.body).toContain("- Situation: 상황");
  });

  it("applies hand-written review.md answers whose 결정 was left empty once the terminal adopts (I1)", async () => {
    const { out } = await grouped();
    await runReview({ file: true });
    const path = join(out, "review.md");
    const { state } = await loadState(out);
    const [e0] = await listExperiences(out, state);
    await writeFile(path, (await readFile(path, "utf8")) + `\n# 2. 질문\n## ${e0.rel}\n### q1 (role) 역할\nA: 팀장\n`);
    const r1 = await runReview({ apply: true, yes: true });
    expect(r1.applied).toEqual([]);
    const r2 = await runReview({ yes: true, io: scripted(["", "", ""], ["adopted"]) });
    expect(r2.applied).toHaveLength(1);
    const { state: s2 } = await loadState(out);
    const [e] = await listExperiences(out, s2);
    expect(e.fm.questions[0].a).toBe("팀장");
    expect(e.body).toContain("- Situation: 상황");
  });

  it("refuses to run on a corrupt state.json and saves nothing (I3)", async () => {
    const { out } = await grouped();
    const sp = join(out, ".mp", "state.json");
    await writeFile(sp, "{ 깨짐");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const o of [{ yes: true, io: scripted(["팀장"], ["adopted"]) }, { file: true }, { apply: true }, { acceptEdits: true, yes: true }]) {
      expect((await runReview(o)).code).toBe(2);
    }
    expect(err.mock.calls.map((c) => String(c[0]))).toContain("state.json 손상 — `mp scan`으로 먼저 정합성 검사 후 다시 실행");
    expect(await readFile(sp, "utf8")).toBe("{ 깨짐");
  });

  it("--accept-edits re-records edited experience cards after one confirm (I3)", async () => {
    const { out } = await grouped();
    let { state } = await loadState(out);
    const [e] = await listExperiences(out, state);
    await writeFile(join(out, e.rel), (await readFile(join(out, e.rel), "utf8")).replace("title: 하나의 경험", "title: 고친 제목"));
    await writeFile(join(out, "experiences", "not-a-card.md"), "---\nkind: file\n---\n");
    ({ state } = await loadState(out));
    expect((await listExperiences(out, state))[0].edited).toBe(true);
    const asked: string[] = [];
    const no = await runReview({ acceptEdits: true, confirm: async (m) => { asked.push(m); return false; } });
    expect(no.code).toBe(0);
    expect(asked).toHaveLength(1);
    ({ state } = await loadState(out));
    expect((await listExperiences(out, state))[0].edited).toBe(true);
    const yes = await runReview({ acceptEdits: true, yes: true, confirm: async () => { throw new Error("asked"); } });
    expect(yes.code).toBe(0);
    ({ state } = await loadState(out));
    const [after] = await listExperiences(out, state);
    expect(after.edited).toBe(false);
    expect(after.fm.title).toBe("고친 제목");
    expect(state.experiences[after.rel].card_snapshot.title).toBe("고친 제목");
    expect(Object.keys(state.experiences)).toEqual([after.rel]);
    const r = await runReview({ yes: true, io: scripted(["팀장", "", "", ""], ["adopted"]) });
    expect(r.applied).toEqual([after.rel]);
  });

  it("does not start an agent when nothing needs applying", async () => {
    const { log } = await grouped();
    const before = (await readFile(log, "utf8")).length;
    await runReview({ yes: true, io: scripted(["", ""], ["excluded"]) });
    expect((await readFile(log, "utf8")).length).toBe(before);
  });
});
