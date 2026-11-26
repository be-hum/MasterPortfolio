import { describe, it, expect, afterEach } from "vitest";
import { createServer } from "node:net";
import { readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { mkTmp } from "../helpers/tmp.js";
import { launch, loadOrCreateToken, ping, readServerInfo, removeServerInfo, tokenId, writeServerInfo, type Ping } from "../../src/ui/runtime.js";
import { startUiServer } from "../../src/ui/server.js";

const TOKEN = "c".repeat(64);
const me = (version: string, busy = false): Ping => ({ app: "MasterPortfolio", version, id: tokenId(TOKEN), busy });

describe("runtime files (11.7)", () => {
  const dirs: string[] = [];
  afterEach(() => { delete process.env.MP_HOME_DIR; for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

  it("token is created once (hex, 0600) and reused", async () => {
    const d = await mkTmp("mp-rt-"); dirs.push(d); process.env.MP_HOME_DIR = join(d, "h");
    const a = loadOrCreateToken(), b = loadOrCreateToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toBe(a);
    if (process.platform !== "win32") expect(statSync(join(d, "h", "token")).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(d, "h", "token"), "utf8")).toBe(a);
  });

  it("server.json is removed only by the process that wrote it", async () => {
    const d = await mkTmp("mp-rt-"); dirs.push(d); process.env.MP_HOME_DIR = d;
    writeServerInfo({ port: 4317, pid: 111, version: "1" });
    removeServerInfo(222);
    expect(readServerInfo()).toMatchObject({ pid: 111 });
    removeServerInfo(111);
    expect(readServerInfo()).toBeNull();
  });
});

describe("launch (11.7)", () => {
  const base = { version: "2", token: TOKEN, sleep: async () => {}, log: () => {} };

  it("already running, same version: opens the browser only", async () => {
    let spawned = 0; const opened: string[] = [];
    const r = await launch({ ...base, spawnServer: () => { spawned++; }, openBrowser: (u) => { opened.push(u); return true; },
      readInfo: () => ({ port: 4318, pid: 1, version: "2" }), ping: async () => me("2") });
    expect(r.code).toBe(0); expect(spawned).toBe(0);
    expect(opened).toEqual([`http://localhost:4318/?t=${TOKEN}`]);
  });

  it("a stale server.json pointing at another app (different id) is ignored: a new server is spawned", async () => {
    let up = false; const opened: string[] = [];
    const r = await launch({ ...base, spawnServer: () => { up = true; }, openBrowser: (u) => { opened.push(u); return true; },
      readInfo: () => ({ port: 4317, pid: 1, version: "2" }),
      ping: async () => (up ? me("2") : { ...me("2"), id: "someoneelse0" }) });
    expect(r.code).toBe(0); expect(up).toBe(true); expect(opened).toHaveLength(1);
  });

  it("older version idle: asks it to shut down, then spawns the new one", async () => {
    const order: string[] = []; let state: "old" | "none" | "new" = "old";
    const r = await launch({ ...base, openBrowser: () => true, readInfo: () => ({ port: 4317, pid: 1, version: "x" }),
      ping: async () => (state === "old" ? me("1") : state === "new" ? me("2") : null),
      shutdown: async () => { order.push("shutdown"); state = "none"; },
      spawnServer: () => { order.push("spawn"); state = "new"; } });
    expect(r.code).toBe(0); expect(order).toEqual(["shutdown", "spawn"]);
  });

  it("older version with a running job: keeps it and opens it (no shutdown)", async () => {
    let shut = 0, spawned = 0;
    const r = await launch({ ...base, openBrowser: () => true, readInfo: () => ({ port: 4317, pid: 1, version: "1" }),
      ping: async () => me("1", true), shutdown: async () => { shut++; }, spawnServer: () => { spawned++; } });
    expect(r.code).toBe(0); expect(shut).toBe(0); expect(spawned).toBe(0);
  });

  it("server never comes up: code 1 with the log location", async () => {
    const lines: string[] = [];
    const r = await launch({ ...base, log: (l) => lines.push(l), waitMs: 50, sleep: (ms) => new Promise((x) => setTimeout(x, Math.min(ms, 10))),
      openBrowser: () => true, readInfo: () => null, ping: async () => null, spawnServer: () => {} });
    expect(r.code).toBe(1); expect(lines.join("\n")).toContain("server.log");
  });
});

describe("port fallback and ping (11.7)", () => {
  it("uses the next port when the first is taken, and ping identifies the server", async () => {
    const blocker = createServer();
    await new Promise<void>((ok) => blocker.listen(0, "127.0.0.1", ok));
    const busy = (blocker.address() as { port: number }).port;
    const srv = await startUiServer({ out: null, ports: [busy, 0], token: TOKEN, version: "9", cliPath: "x.js", html: () => "x" });
    try {
      expect(srv.port).not.toBe(busy);
      expect(await ping(srv.port)).toEqual(me("9"));
      expect(await ping(busy, 300)).toBeNull();
    } finally { await srv.close(); blocker.close(); }
  });
});
