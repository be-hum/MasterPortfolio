import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { mkTmp } from "../helpers/tmp.js";
import { seedCards } from "../helpers/cards.js";
import { runGroup } from "../../src/commands/group.js";
import { listExperiences, saveExperience } from "../../src/store/experiences.js";
import { loadState } from "../../src/store/state.js";
import { sha256String } from "../../src/core/hash.js";

const dirs: string[] = [];
async function setup(cards: Parameters<typeof seedCards>[1], scenario = "ok") {
  const out = await mkTmp("mp-out-"); dirs.push(out);
  process.env.MP_OUTPUT_DIR = out;
  const log = await seedCards(out, cards, scenario);
  return { out, log };
}

describe("runGroup (11.1)", () => {
  beforeEach(() => { vi.spyOn(console, "log").mockImplementation(() => {}); });
  afterEach(async () => { vi.restoreAllMocks(); delete process.env.MP_OUTPUT_DIR; await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });

  it("groups 상/중 cards only, sends no paths, and creates pending experience cards with questions", async () => {
    const { out, log } = await setup([{ value: "상" }, { value: "중", summary: "연락처 010-1234-5678" }, { value: "하" }, { value: null }], "group-one");
    const r = await runGroup({ yes: true });
    expect(r.code).toBe(0);
    expect(r.created).toHaveLength(1);
    const { state } = await loadState(out);
    const [e] = await listExperiences(out, state);
    expect(e.fm.review).toBe("pending");
    expect(e.fm.evidence.sort()).toEqual(["files/card-0.md", "files/card-1.md"]);
    expect(e.fm.value).toBe("상");
    expect(e.fm.questions.map((q) => q.id)).toEqual(["q1", "q2", "q3", "q4"]); // role, metrics + 기본 질문(기여도·기간)
    const prompts = await readFile(log, "utf8");
    expect(prompts).not.toContain("/src/f");
    expect(prompts).not.toContain("010-1234-5678");
    expect(prompts).toContain('"model":"opus"');
  });

  it("sets category and appends local base questions, dropping the LLM period question (11.4)", async () => {
    const { out } = await setup([{ modified: "2026-11-03", period: null }], "group-one");
    await runGroup({ yes: true });
    const { state } = await loadState(out);
    const [e] = await listExperiences(out, state);
    expect(e.fm.category).toBe("프로젝트");
    expect(e.fm.questions.filter((q) => q.field === "contribution")).toHaveLength(1);
    const periods = e.fm.questions.filter((q) => q.field === "period");
    expect(periods).toHaveLength(1);
    expect(periods[0].q).toContain("근거 파일 수정일: 2026-11");
    expect(e.fm.questions.some((q) => q.q === "언제였나요?")).toBe(false);
  });

  it("state.json on disk holds the hash of every card it wrote (C1)", async () => {
    const { out } = await setup([{ title: "보고서" }, { title: "발표" }]);
    const r = await runGroup({ yes: true });
    expect(r.created).toHaveLength(2);
    const { state } = await loadState(out);
    for (const rel of r.created) expect(state.experiences[rel].card_body_hash).toBe(sha256String(await readFile(join(out, rel), "utf8")));
    expect((await listExperiences(out, state)).every((e) => !e.edited)).toBe(true);
  });

  it("refuses to run on a corrupt state.json and saves nothing (I3)", async () => {
    const { out, log } = await setup([{ title: "보고서" }]);
    const sp = join(out, ".mp", "state.json");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(sp, "{ 깨짐");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await runGroup({ yes: true })).code).toBe(2);
    expect(err.mock.calls.map((c) => String(c[0]))).toContain("state.json 손상 — `mp scan`으로 먼저 정합성 검사 후 다시 실행");
    expect(await readFile(sp, "utf8")).toBe("{ 깨짐");
    await expect(readFile(log, "utf8")).rejects.toThrow();
  });

  it("marks unassigned cards ungrouped and does not resend them unless --regroup", async () => {
    const { out } = await setup([{ title: "UNASSIGN 메모" }, { title: "보고서" }]);
    await runGroup({ yes: true });
    let { state } = await loadState(out);
    expect(state.files["/src/f0.md"].grouping).toBe("ungrouped");
    expect((await runGroup({ yes: true })).created).toHaveLength(0);
    const again = await runGroup({ yes: true, regroup: true });
    expect(again.ungrouped).toBe(1);
  });

  it("attaches a new card to an adopted experience, keeps it adopted and adds only new questions (Review Focus 4)", async () => {
    const { out } = await setup([{ title: "첫 보고서" }]);
    await runGroup({ yes: true });
    let { state } = await loadState(out);
    let [e] = await listExperiences(out, state);
    await saveExperience(out, state, e, { ...e.fm, review: "adopted", questions: e.fm.questions.map((q) => ({ ...q, a: "팀장" })) });
    const { saveState } = await import("../../src/store/state.js");
    await saveState(out, state);
    await seedMore(out, { title: "ATTACH 발표" });
    const r = await runGroup({ yes: true });
    expect(r.attached).toHaveLength(1);
    ({ state } = await loadState(out));
    [e] = await listExperiences(out, state);
    expect(e.fm.review).toBe("adopted");
    expect(e.fm.evidence).toHaveLength(2);
    expect(e.fm.questions.filter((q) => q.a === null).map((q) => q.q)).toEqual(["추가 성과는?"]);
  });

  it("never overwrites a user-edited experience on attach", async () => {
    const { out } = await setup([{ title: "첫 보고서" }]);
    await runGroup({ yes: true });
    const { state } = await loadState(out);
    const [e] = await listExperiences(out, state);
    const { appendFile } = await import("node:fs/promises");
    await appendFile(join(out, e.rel), "\n내 메모\n");
    await seedMore(out, { title: "ATTACH 발표" });
    const r = await runGroup({ yes: true });
    expect(r.skippedEdited).toEqual([e.rel]);
    expect(await readFile(join(out, e.rel), "utf8")).toContain("내 메모");
  });

  it("stops with code 3 on a rate limit and writes nothing", async () => {
    const { out } = await setup([{}], "group-rate-limit");
    const r = await runGroup({ yes: true });
    expect(r.code).toBe(3);
    const { state } = await loadState(out);
    expect(await listExperiences(out, state)).toEqual([]);
  });

  it("does not start an agent when there is nothing to group", async () => {
    const { log } = await setup([{ value: "하" }]);
    expect((await runGroup({ yes: true })).code).toBe(0);
    await expect(readFile(log, "utf8")).rejects.toThrow();
  });

  const big = "가".repeat(1200);
  const bigCards = () => [{ value: "중" as const, title: `A ${big}`, summary: big }, { value: "상" as const, title: `B ${big}`, summary: big }, { value: "중" as const, title: `C ${big}`, summary: big }];
  const manyBig = () => Array.from({ length: 30 }, (_, i) => ({ value: (i === 1 ? "상" : "중") as "상" | "중", title: `T${i} ${big}`, summary: big }));

  it("merges experiences across batches into one card with unioned evidence and best value", async () => {
    const { out } = await setup(manyBig(), "group-merge");
    const r = await runGroup({ yes: true });
    expect(r.code).toBe(0);
    const { state } = await loadState(out);
    const es = await listExperiences(out, state);
    expect(es).toHaveLength(29);
    const merged = es.filter((e) => e.fm.evidence.length === 2);
    expect(merged).toHaveLength(1);
    expect(merged[0].fm.value).toBe("상");
    expect(merged[0].fm.questions).toHaveLength(5); // 11.1: LLM 질문 최대 3개 + 기본 질문 2개(기여도·기간)
    expect(es.reduce((n, e) => n + e.fm.evidence.length, 0)).toBe(30);
  });

  it("keeps batch results when the merge pass crashes (code 0)", async () => {
    const { out } = await setup(manyBig(), "group-merge-fail");
    const r = await runGroup({ yes: true });
    expect(r.code).toBe(0);
    const { state } = await loadState(out);
    expect(await listExperiences(out, state)).toHaveLength(30);
  });

  it("keeps batch results but returns code 3 when the merge pass hits a rate limit", async () => {
    const { out } = await setup(manyBig(), "group-merge-rate-limit");
    const r = await runGroup({ yes: true });
    expect(r.code).toBe(3);
    const { state } = await loadState(out);
    expect(await listExperiences(out, state)).toHaveLength(30);
  });

  it("restarts the agent once after a crash and groups all cards", async () => {
    const { out } = await setup([{}, {}, {}], "group-crash-once");
    const r = await runGroup({ yes: true });
    expect(r.code).toBe(0);
    expect(r.created).toHaveLength(3);
    const { state } = await loadState(out);
    expect(await listExperiences(out, state)).toHaveLength(3);
  });
});

/** 기존 결과 폴더에 판정된 카드 하나를 더 넣는다(다음 스캔 흉내) */
async function seedMore(out: string, over: Record<string, unknown>) {
  const { writeFile } = await import("node:fs/promises");
  const { FileCardFrontmatter } = await import("../../src/core/schema.js");
  const { stringifyCard } = await import("../../src/store/frontmatter.js");
  const { sha256String } = await import("../../src/core/hash.js");
  const { loadState, saveState } = await import("../../src/store/state.js");
  const fm = FileCardFrontmatter.parse({
    schema_version: 1, kind: "file", source: "/src/new.md", source_hash: "sha256:999999", format: "md", size: 1, modified: "2025-07-01",
    duplicates: [], type: "발표", use_for: [], title: "새 카드", summary: "요약", period: null, role: null, skills: [], metrics: [], org: null,
    value: "상", value_reason: "근거", in_resume: "판단불가", agent: "claude", generated_at: "x", ...over,
  });
  const content = stringifyCard(fm, "## 상세 요약\n내용\n");
  await writeFile(join(out, "files", "card-new.md"), content);
  const { state } = await loadState(out);
  state.files["/src/new.md"] = { source_hash: fm.source_hash, card: "files/card-new.md", card_body_hash: sha256String(content), card_snapshot: {}, status: "done" };
  await saveState(out, state);
}
