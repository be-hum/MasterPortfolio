import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { mkTmp } from "../helpers/tmp.js";
import { runStart } from "../../src/commands/start.js";
import { runServe } from "../../src/commands/ui.js";
import { readServerInfo } from "../../src/ui/runtime.js";

describe("mp start (launcher, 11.7)", () => {
  afterEach(() => vi.restoreAllMocks());
  it("spawns the background server when none runs and opens the browser at localhost with the token", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    let spawned = 0; const opened: string[] = []; let up = false;
    const code = await runStart({
      token: "a".repeat(64), spawnServer: () => { spawned++; up = true; }, openBrowser: (u) => { opened.push(u); return true; },
      readInfo: () => (up ? { port: 4317, pid: 1, version: "x" } : null),
      ping: async () => (up ? { app: "MasterPortfolio", version: (await import("../../src/version.js")).VERSION, id: (await import("../../src/ui/runtime.js")).tokenId("a".repeat(64)), busy: false } : null),
      sleep: async () => {},
    });
    expect(code).toBe(0);
    expect(spawned).toBe(1);
    expect(opened).toEqual([`http://localhost:4317/?t=${"a".repeat(64)}`]);
  });
});

describe("mp serve (11.7)", () => {
  const dirs: string[] = [];
  afterEach(async () => { vi.restoreAllMocks(); for (const k of ["MP_OUTPUT_DIR", "MP_POINTER_FILE", "MP_HOME_DIR"]) delete process.env[k]; await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });

  it("writes server.json while running and removes it on stop; reuses the token file", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const d = await mkTmp("mp-serve-"); dirs.push(d);
    process.env.MP_HOME_DIR = join(d, "home"); process.env.MP_OUTPUT_DIR = join(d, "out"); await mkdir(join(d, "out"), { recursive: true });
    let ready!: (v: { port: number; close: () => Promise<void> }) => void;
    const got = new Promise<{ port: number; close: () => Promise<void> }>((r) => { ready = r; });
    const done = runServe({ ports: [0], cliPath: "unused.js", onReady: (port, close) => ready({ port, close }) });
    const { port, close } = await got;
    expect(readServerInfo()).toMatchObject({ port, pid: process.pid });
    const tok = await readFile(join(d, "home", "token"), "utf8");
    expect(tok).toMatch(/^[0-9a-f]{64}$/);
    const j = await (await fetch(`http://127.0.0.1:${port}/api/ping`)).json();
    expect(j.app).toBe("MasterPortfolio");
    await close(); expect(await done).toBe(0);
    expect(readServerInfo()).toBeNull();
  });
});
