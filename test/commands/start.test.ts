import { describe, it, expect, vi, afterEach } from "vitest";
import { rm } from "node:fs/promises";
import { mkTmp } from "../helpers/tmp.js";
import { runStart } from "../../src/commands/start.js";

describe("mp start", () => {
  const dirs: string[] = [];
  afterEach(async () => { vi.restoreAllMocks(); delete process.env.MP_OUTPUT_DIR; delete process.env.MP_POINTER_FILE; await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });

  it("runs setup first when there is no output folder, then opens the UI", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const d = await mkTmp("mp-start-"); dirs.push(d);
    process.env.MP_POINTER_FILE = `${d}/none.json`;
    const calls: string[] = [];
    const code = await runStart({
      init: async () => { calls.push("init"); process.env.MP_OUTPUT_DIR = d; return 0; },
      ui: async () => { calls.push("ui"); return { code: 0 }; },
    });
    expect(code).toBe(0);
    expect(calls).toEqual(["init", "ui"]);
  });

  it("goes straight to the UI when already set up, and stops if setup fails", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {}); vi.spyOn(console, "error").mockImplementation(() => {});
    const d = await mkTmp("mp-start-"); dirs.push(d);
    process.env.MP_OUTPUT_DIR = d;
    const calls: string[] = [];
    expect(await runStart({ init: async () => { calls.push("init"); return 0; }, ui: async () => { calls.push("ui"); return { code: 0 }; } })).toBe(0);
    expect(calls).toEqual(["ui"]);
    delete process.env.MP_OUTPUT_DIR; process.env.MP_POINTER_FILE = `${d}/none.json`;
    expect(await runStart({ init: async () => 2, ui: async () => { calls.push("ui2"); return { code: 0 }; } })).toBe(2);
    expect(calls).not.toContain("ui2");
  });
});
