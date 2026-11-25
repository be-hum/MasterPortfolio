import { describe, it, expect, vi, afterEach } from "vitest";
import { etaSeconds, overallProgress, progress, PROGRESS_PREFIX } from "../../src/core/progress.js";

describe("progress", () => {
  afterEach(() => { progress.reset(); delete process.env.MP_PROGRESS; vi.restoreAllMocks(); });

  const capture = () => {
    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation(((s: string) => { out.push(s); return true; }) as never);
    return () => out.filter((l) => l.startsWith(PROGRESS_PREFIX)).map((l) => JSON.parse(l.slice(PROGRESS_PREFIX.length)));
  };

  it("prints nothing unless MP_PROGRESS=1", () => {
    const got = capture();
    progress.begin("extract"); progress.report(1, 7);
    expect(got()).toEqual([]);
  });

  it("continues counting when the same stage restarts (agent crash), and resets on a new stage", () => {
    process.env.MP_PROGRESS = "1";
    const got = capture();
    progress.begin("extract"); progress.report(0, 7); progress.report(3, 7);
    progress.begin("extract"); progress.report(0, 4); progress.report(2, 4); // 남은 4개로 재시작
    progress.begin("judge"); progress.report(1, 2);
    expect(got()).toEqual([
      { stage: "extract", done: 0, total: 7 }, { stage: "extract", done: 3, total: 7 },
      { stage: "extract", done: 3, total: 7 }, { stage: "extract", done: 5, total: 7 },
      { stage: "judge", done: 1, total: 2 },
    ]);
  });

  it("override renames the stage for the next begin (pending judge before triage)", () => {
    process.env.MP_PROGRESS = "1";
    const got = capture();
    progress.override("judge-pending"); progress.begin("judge"); progress.report(1, 1); progress.override(null);
    progress.begin("judge"); progress.report(0, 3);
    expect(got().map((e) => e.stage)).toEqual(["judge-pending", "judge"]);
  });

  it("overall uses stage order and weights; earlier (skipped) stages count as done", () => {
    expect(overallProgress("scan", { stage: "triage", done: 0, total: 2 })).toBeCloseTo(0.15);
    expect(overallProgress("scan", { stage: "extract", done: 3, total: 6 })).toBeCloseTo(0.3 + 0.25);
    expect(overallProgress("scan", { stage: "judge", done: 2, total: 2 })).toBeCloseTo(1);
    expect(overallProgress("apply", { stage: "review", done: 1, total: 4 })).toBeCloseTo(0.25);
    expect(overallProgress("scan", { stage: "unknown", done: 1, total: 2 })).toBeNull();
    expect(overallProgress("master", { stage: "extract", done: 1, total: 2 })).toBeNull();
  });

  it("eta only after 15% and 20s", () => {
    expect(etaSeconds(0.1, 60_000)).toBeNull();
    expect(etaSeconds(0.5, 10_000)).toBeNull();
    expect(etaSeconds(0.5, 120_000)).toBe(120);
    expect(etaSeconds(1, 120_000)).toBeNull();
  });
});
