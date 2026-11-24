import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFile, rm } from "node:fs/promises";
import { mkTmp } from "../helpers/tmp.js";
import { seedCards } from "../helpers/cards.js";
import { runGroup } from "../../src/commands/group.js";
import { runKeywords } from "../../src/commands/keywords.js";
import { runReview } from "../../src/commands/review.js";
import { listExperiences, saveExperience } from "../../src/store/experiences.js";
import { loadState } from "../../src/store/state.js";

const dirs: string[] = [];
describe("runKeywords / apply-only", () => {
  beforeEach(() => { vi.spyOn(console, "log").mockImplementation(() => {}); });
  afterEach(async () => { vi.restoreAllMocks(); delete process.env.MP_OUTPUT_DIR; await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });
  async function grouped(scenario = "group-one") {
    const out = await mkTmp("mp-out-"); dirs.push(out); process.env.MP_OUTPUT_DIR = out;
    const log = await seedCards(out, [{ title: "보고서" }, { title: "발표" }], scenario);
    await runGroup({ yes: true });
    return { out, log };
  }
  async function clear(out: string) {
    const { state } = await loadState(out);
    for (const e of await listExperiences(out, state)) await saveExperience(out, state, e, { ...e.fm, keywords: [], outcome_keywords: [] });
    return state;
  }

  it("group fills keywords", async () => {
    const { out } = await grouped();
    const { state } = await loadState(out);
    const [e] = await listExperiences(out, state);
    expect(e.fm.keywords).toEqual(["역분석", "입력 복원"]);
    expect(e.fm.outcome_keywords).toEqual(["키 복원"]);
  });

  it("fills empty cards with the triage model, then has no targets without --all", async () => {
    const { out, log } = await grouped();
    await clear(out);
    expect((await runKeywords({ yes: true, logPrompts: true })).code).toBe(0);
    const { state } = await loadState(out);
    const [e] = await listExperiences(out, state);
    expect(e.fm.keywords).toEqual(["경험 키워드"]);
    expect(e.fm.outcome_keywords).toEqual(["성과 키워드"]);
    const l = await readFile(log, "utf8");
    expect(l).toContain('"stage":"keywords"');
    expect(l).toContain('"model":"haiku"');
    vi.mocked(console.log).mockClear();
    await runKeywords({ yes: true });
    expect(vi.mocked(console.log).mock.calls.flat().join("\n")).toContain("키워드를 만들 경험이 없습니다.");
  });

  it("keywords-garbage retries and succeeds", async () => {
    const { out } = await grouped("keywords-garbage");
    await clear(out);
    expect((await runKeywords({ yes: true })).code).toBe(0);
    const { state } = await loadState(out);
    expect((await listExperiences(out, state))[0].fm.keywords).toEqual(["경험 키워드"]);
  });

  it("review applyOnly applies pending cards without IO", async () => {
    const { out } = await grouped();
    const { state } = await loadState(out);
    const [e] = await listExperiences(out, state);
    await saveExperience(out, state, e, { ...e.fm, review: "adopted", pending_apply: true, questions: e.fm.questions.map((q) => ({ ...q, a: q.field === "role" ? "팀장" : null })) });
    const r = await runReview({ applyOnly: true, yes: true });
    expect(r.code).toBe(0);
    expect(r.applied).toHaveLength(1);
  });
});
