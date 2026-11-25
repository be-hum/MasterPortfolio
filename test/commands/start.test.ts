import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { mkTmp } from "../helpers/tmp.js";
import { runStart } from "../../src/commands/start.js";

describe("mp start", () => {
  const dirs: string[] = [];
  afterEach(async () => { vi.restoreAllMocks(); delete process.env.MP_OUTPUT_DIR; delete process.env.MP_POINTER_FILE; await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });

  it("opens the UI in setup mode when there is no output folder", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const d = await mkTmp("mp-start-"); dirs.push(d);
    process.env.MP_POINTER_FILE = `${d}/none.json`;
    const calls: unknown[] = [];
    const code = await runStart({ ui: async (o) => { calls.push(o); return { code: 0 }; }, defaultOutput: async () => `${d}/no-results-here` });
    expect(code).toBe(0);
    expect(calls).toEqual([{ setup: true }]);
    expect(log).toHaveBeenCalledWith("처음 설정 화면을 브라우저에서 엽니다.");
  });

  it("adopts an existing result folder at the real Documents location when the pointer is missing", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const d = await mkTmp("mp-start-"); dirs.push(d);
    process.env.MP_POINTER_FILE = `${d}/ptr.json`;
    const docsOut = `${d}/OneDrive/문서/MasterPortfolio`;
    await mkdir(`${docsOut}/.mp`, { recursive: true }); await writeFile(`${docsOut}/.mp/config.json`, "{}");
    const calls: unknown[] = [];
    expect(await runStart({ ui: async (o) => { calls.push(o); return { code: 0 }; }, defaultOutput: async () => docsOut })).toBe(0);
    expect(calls).toEqual([{}]);
    expect(JSON.parse(await readFile(`${d}/ptr.json`, "utf8")).outputDir).toBe(docsOut);
  });

  it("goes straight to the UI when already set up", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const d = await mkTmp("mp-start-"); dirs.push(d);
    process.env.MP_OUTPUT_DIR = d;
    const calls: unknown[] = [];
    expect(await runStart({ ui: async (o) => { calls.push(o); return { code: 0 }; } })).toBe(0);
    expect(calls).toEqual([{}]);
  });
});
