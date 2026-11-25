import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { mkTmp } from "../helpers/tmp.js";
import { startUiServer, type SetupDeps } from "../../src/ui/server.js";
import { PickUnavailable } from "../../src/setup/pickFolder.js";
import { loadConfig, saveConfig } from "../../src/config/config.js";
import { resolveOutputDir } from "../../src/core/paths.js";

const TOKEN = "t".repeat(64);
const dirs: string[] = [];
const closers: (() => Promise<void>)[] = [];

async function boot(out: string | null, setupDeps: SetupDeps = {}) {
  const srv = await startUiServer({ out, token: TOKEN, cliPath: "unused.js", html: () => "x", setupDeps });
  closers.push(srv.close);
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`http://127.0.0.1:${srv.port}${path}`, { method, headers: { "x-mp-token": TOKEN, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text(); let json: any = null; try { json = JSON.parse(text); } catch { /* */ }
    return { status: r.status, json };
  };
  return { call };
}
const tmp = async () => { const d = await mkTmp("mp-su-"); dirs.push(d); return d; };

describe("setup mode (11.6)", () => {
  beforeEach(async () => { vi.spyOn(console, "log").mockImplementation(() => {}); process.env.MP_POINTER_FILE = join(await tmp(), "ptr.json"); delete process.env.MP_OUTPUT_DIR; });
  afterEach(async () => {
    vi.restoreAllMocks(); delete process.env.MP_POINTER_FILE; delete process.env.MP_OUTPUT_DIR;
    await Promise.all(closers.splice(0).map((c) => c()));
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  it("blocks data/job/settings routes with 409 and reports setup:true", async () => {
    const { call } = await boot(null);
    expect((await call("GET", "/api/state")).json).toEqual({ ok: true, setup: true });
    for (const [m, p] of [["GET", "/api/job"], ["POST", "/api/job"], ["POST", "/api/job/stop"], ["GET", "/api/folder-hints"], ["GET", "/api/agent-status"], ["POST", "/api/scope-answer"], ["POST", "/api/folder-hints"], ["POST", "/api/decide"], ["GET", "/api/settings"], ["POST", "/api/settings"], ["POST", "/api/settings/scope-reset"], ["GET", "/files/x.md"]] as const) {
      const r = await call(m, p, m === "POST" ? {} : undefined);
      expect([p, r.status, r.json?.error]).toEqual([p, 409, "처음 설정이 필요합니다."]);
    }
  });

  it("suggests folders, expands university, and returns the injected default output", async () => {
    const seen: string[][] = [];
    const { call } = await boot(null, {
      suggest: async (k) => { seen.push(k); return [{ path: "/a", label: "A", kind: "documents", checked: true }]; },
      defaultOutput: async () => "/out/default",
    });
    const r = await call("GET", "/api/setup/suggest?university=" + encodeURIComponent("연세대"));
    expect(r.status).toBe(200);
    expect(r.json.keywords).toContain("연세대학교");
    expect(seen[0]).toEqual(r.json.keywords);
    expect(r.json.folders).toHaveLength(1);
    expect(r.json.defaultOutput).toBe("/out/default");
  });

  it("an output folder that already has results is not overwritten: 409 existing, then adopt", async () => {
    const scan = await tmp(), out = join(await tmp(), "mp");
    await mkdir(join(out, ".mp"), { recursive: true });
    const { defaultConfig } = await import("../../src/config/config.js");
    const old = defaultConfig({ university: { input: "", keywords: [] }, scanFolders: [scan], agent: "claude" }); old.budget.planScale = 20;
    await saveConfig(out, old);
    const { call } = await boot(null);
    const r1 = await call("POST", "/api/setup", { university: "", keywords: [], folders: [scan], planScale: 1, output: out });
    expect(r1.status).toBe(409);
    expect(r1.json.existing).toBe(out);
    expect((await call("GET", "/api/state")).json.setup).toBe(true);
    const r2 = await call("POST", "/api/setup", { university: "", keywords: [], folders: [], planScale: 1, output: out, adopt: true });
    expect(r2.status).toBe(200);
    expect((await loadConfig(out)).budget.planScale).toBe(20);
    expect((await call("GET", "/api/state")).json.setup).toBeUndefined();
  });

  it("setup success switches to normal mode; second setup is 409; invalid is 400", async () => {
    const scan = await tmp(), out = join(await tmp(), "결과");
    const { call } = await boot(null);
    const bad = await call("POST", "/api/setup", { university: "연세대", keywords: ["연세대"], folders: [join(scan, "nope")], planScale: 1, output: out });
    expect(bad.status).toBe(400);
    expect(bad.json.errors.length).toBeGreaterThan(0);
    const ok = await call("POST", "/api/setup", { university: "연세대", keywords: ["연세대"], folders: [scan], planScale: 5, output: out });
    expect(ok.status).toBe(200);
    expect(ok.json.output).toBe(out);
    const st = await call("GET", "/api/state");
    expect(Array.isArray(st.json.experiences)).toBe(true);
    expect((await loadConfig(out)).budget.planScale).toBe(5);
    expect(await resolveOutputDir()).toBe(out);
    expect((await call("POST", "/api/setup", { university: "x", keywords: [], folders: [scan], planScale: 1, output: out })).status).toBe(409);
  });

  it("pick-folder: one at a time, unavailable -> 400, file -> 400, folder ok", async () => {
    const d = await tmp(); const f = join(d, "f.txt"); await writeFile(f, "x");
    let release: (() => void) | undefined; let next: string | null = d; let throwIt = false;
    const { call } = await boot(null, { pick: async () => { if (throwIt) throw new PickUnavailable(); await new Promise<void>((r) => { release = r; }); return next; } });
    const first = call("POST", "/api/pick-folder", {});
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    expect((await call("POST", "/api/pick-folder", {})).status).toBe(409);
    release!(); release = undefined;
    expect((await first).json).toEqual({ ok: true, path: d });
    next = f; const p2 = call("POST", "/api/pick-folder", {});
    await vi.waitFor(() => expect(release).toBeTypeOf("function")); release!();
    expect((await p2).status).toBe(400);
    throwIt = true;
    const r = await call("POST", "/api/pick-folder", {});
    expect(r.status).toBe(400); expect(r.json.error).toContain("직접 입력");
  });

  it("setup stores unchecked WSL suggestions as dismissed", async () => {
    const scan = await tmp(), out = join(await tmp(), "o");
    const w = "\\\\wsl.localhost\\U\\home\\a\\projects";
    const { call } = await boot(null);
    expect((await call("POST", "/api/setup", { university: "", keywords: [], folders: [scan], planScale: 1, output: out, dismissed: [w, 3] })).status).toBe(200);
    expect((await loadConfig(out)).dismissedFolders).toEqual([w]);
  });

  it("check returns the injected result (null out in setup mode)", async () => {
    const items = [{ ok: true, label: "Node" }];
    let args: unknown[] = [];
    const { call } = await boot(null, { check: async (...a) => { args = a; return items; } });
    const r = await call("POST", "/api/check", { skipAgent: true });
    expect(r.json).toEqual({ ok: true, items });
    expect(args).toEqual([null, { skipAgent: true }]);
  });
});

describe("settings API (11.6)", () => {
  afterEach(async () => {
    vi.restoreAllMocks(); delete process.env.MP_POINTER_FILE;
    await Promise.all(closers.splice(0).map((c) => c()));
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  async function normal() {
    const scan = await tmp(), out = await tmp();
    const { createSetupConfig } = await import("../../src/setup/config.js");
    process.env.MP_POINTER_FILE = join(await tmp(), "p.json");
    await createSetupConfig({ university: "연세대", keywords: ["연세대"], folders: [scan], planScale: 1, output: out });
    const c = await loadConfig(out);
    c.scope.decisions = {
      [join(scan, "a")]: { decision: "exclude", by: "user", at: "t" },
      [join(scan, "a", "b")]: { decision: "include", by: "llm", at: "t" },
      [join(scan, "c")]: { decision: "exclude", by: "llm", at: "t" },
    };
    await saveConfig(out, c);
    return { scan, out, ...(await boot(out)) };
  }

  it("a folder already in the config is kept even if it is currently unreachable (e.g. WSL off); only new ones are checked", async () => {
    const { scan, out, call } = await normal();
    const c = await loadConfig(out);
    const offline = join(scan, "offline-share"); // 없는 폴더 = 지금은 안 보이는 기존 폴더
    c.scanFolders = [scan, offline]; await saveConfig(out, c);
    const extra = await tmp();
    const r = await call("POST", "/api/settings", { scanFolders: [scan, offline, extra] });
    expect(r.status).toBe(200);
    expect((await loadConfig(out)).scanFolders).toEqual([scan, offline, extra]);
    expect((await call("POST", "/api/settings", { scanFolders: [offline] })).status).toBe(200);
    expect((await loadConfig(out)).scanFolders).toEqual([offline]);
    expect((await call("POST", "/api/settings", { scanFolders: [offline, join(scan, "새로-없는")] })).status).toBe(400);
  });

  it("GET returns settings; POST saves planScale and a new folder", async () => {
    const { scan, out, call } = await normal();
    const g = await call("GET", "/api/settings");
    expect(g.json).toMatchObject({ ok: true, output: out, university: "연세대", keywords: ["연세대"], scanFolders: [scan], planScale: 1 });
    expect(g.json.scope).toHaveLength(3);
    expect(g.json.scope[0]).toHaveProperty("by");
    const extra = await tmp(); await mkdir(join(extra, "z"));
    const p = await call("POST", "/api/settings", { planScale: 5, fiveHourShare: 0.5, scanFolders: [scan, extra], keywords: ["연세대", " 신촌 "] });
    expect(p.status).toBe(200);
    const c = await loadConfig(out);
    expect(c.budget).toMatchObject({ planScale: 5, fiveHourShare: 0.5 });
    expect(c.scanFolders).toEqual([scan, extra]);
    expect(c.university.keywords).toEqual(["연세대", "신촌"]);
  });

  it("rejects bad values with 400", async () => {
    const { scan, out, call } = await normal();
    expect((await call("POST", "/api/settings", { scanFolders: [scan, join(scan, "없는")] })).status).toBe(400);
    expect((await call("POST", "/api/settings", { scanFolders: [out] })).status).toBe(400);
    expect((await call("POST", "/api/settings", { planScale: 3 })).status).toBe(400);
    expect((await call("POST", "/api/settings", { fiveHourShare: 0.01 })).status).toBe(400);
    expect((await call("POST", "/api/settings", { fiveHourShare: 1.5 })).status).toBe(400);
    expect((await loadConfig(out)).budget.planScale).toBe(1);
  });

  it("returns 409 while a job runs", async () => {
    const scan = await tmp(), out = await tmp();
    const { createSetupConfig } = await import("../../src/setup/config.js");
    process.env.MP_POINTER_FILE = join(await tmp(), "p.json");
    await createSetupConfig({ university: "x", keywords: [], folders: [scan], planScale: 1, output: out });
    const cli = join(await tmp(), "slow.js"); await writeFile(cli, "setTimeout(()=>{},3000)");
    const srv = await startUiServer({ out, token: TOKEN, cliPath: cli, html: () => "x" });
    closers.push(srv.close);
    const post = (path: string, body: unknown) => fetch(`http://127.0.0.1:${srv.port}${path}`, { method: "POST", headers: { "x-mp-token": TOKEN }, body: JSON.stringify(body) });
    expect((await post("/api/job", { kind: "scan" })).status).toBe(200);
    expect((await post("/api/settings", { planScale: 5 })).status).toBe(409);
    expect((await post("/api/settings/scope-reset", { path: scan })).status).toBe(409);
  });

  it("folder hints: new WSL folders are offered once per server; add puts them in scanFolders, dismiss never asks again", async () => {
    const scan = await tmp(), out = await tmp();
    const { createSetupConfig } = await import("../../src/setup/config.js");
    process.env.MP_POINTER_FILE = join(await tmp(), "p.json");
    await createSetupConfig({ university: "연세대", keywords: ["연세대"], folders: [scan], planScale: 1, output: out });
    const A = "\\\\wsl.localhost\\U\\home\\a\\projects", B = "\\\\wsl.localhost\\U\\home\\a\\portfolio", C = "\\\\wsl.localhost\\U\\home\\a\\dev";
    const c0 = await loadConfig(out); c0.scanFolders.push("\\\\wsl$\\U\\home\\a\\dev"); await saveConfig(out, c0); // 별칭으로 이미 있음
    let calls = 0; let kw: string[] = [];
    const srv = await startUiServer({ out, token: TOKEN, cliPath: "unused.js", html: () => "x", setupDeps: { folderHints: async (k) => { calls++; kw = k; return [A, B, C].map((path) => ({ path, label: path })); } } });
    closers.push(srv.close);
    const call = async (m: string, p: string, body?: unknown) => { const r = await fetch(`http://127.0.0.1:${srv.port}${p}`, { method: m, headers: { "x-mp-token": TOKEN }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, json: await r.json() }; };
    expect((await call("GET", "/api/folder-hints")).json.folders.map((f: any) => f.path)).toEqual([A, B]);
    expect(kw).toEqual(["연세대"]);
    expect((await call("POST", "/api/folder-hints", { add: ["/not/offered"] })).status).toBe(400);
    expect((await call("POST", "/api/folder-hints", { add: [A], dismiss: [B] })).json).toMatchObject({ ok: true, added: 1, dismissed: 1 });
    const c = await loadConfig(out);
    expect(c.scanFolders).toContain(A);
    expect(c.dismissedFolders).toEqual([B]);
    expect((await call("GET", "/api/folder-hints")).json.folders).toEqual([]);
    expect(calls).toBe(1);
  });

  it("agent status: probed once and cached; refresh=1 probes again", async () => {
    const scan = await tmp(), out = await tmp();
    const { createSetupConfig } = await import("../../src/setup/config.js");
    process.env.MP_POINTER_FILE = join(await tmp(), "p.json");
    await createSetupConfig({ university: "", keywords: [], folders: [scan], planScale: 1, output: out });
    let n = 0;
    const srv = await startUiServer({ out, token: TOKEN, cliPath: "unused.js", html: () => "x", setupDeps: { probe: async () => (++n === 1 ? { ok: false, kind: "auth", label: "x", fix: "y" } : { ok: true }) } });
    closers.push(srv.close);
    const get = async (p: string) => (await (await fetch(`http://127.0.0.1:${srv.port}${p}`, { headers: { "x-mp-token": TOKEN } })).json()).agent;
    expect(await get("/api/agent-status")).toMatchObject({ ok: false, kind: "auth" });
    expect(await get("/api/agent-status")).toMatchObject({ ok: false, kind: "auth" });
    expect(n).toBe(1);
    expect(await get("/api/agent-status?refresh=1")).toEqual({ ok: true });
    expect(n).toBe(2);
  });

  it("scope questions: listed in settings and counted in state; answering stores a user decision; reset clears questions too", async () => {
    const { scan, out, call } = await normal();
    const c = await loadConfig(out);
    const q = (n: number) => ({ q: "본인 자료인가요?", fileCount: n, extCounts: { pdf: n }, samples: ["a.pdf"], at: "t" });
    c.scope.questions = { [join(scan, "q1")]: q(2), [join(scan, "q2")]: q(3), [join(scan, "z", "q3")]: q(1) };
    await saveConfig(out, c);
    expect((await call("GET", "/api/state")).json.scopeQuestions).toBe(3);
    expect((await call("GET", "/api/settings")).json.questions.map((x: any) => x.path).sort()).toEqual([join(scan, "q1"), join(scan, "q2"), join(scan, "z", "q3")].sort());
    expect((await call("POST", "/api/scope-answer", { path: join(scan, "q1"), decision: "maybe" })).status).toBe(400);
    expect((await call("POST", "/api/scope-answer", { path: join(scan, "nope"), decision: "include" })).status).toBe(404);
    expect((await call("POST", "/api/scope-answer", { path: join(scan, "q1"), decision: "exclude" })).json).toEqual({ ok: true, left: 2 });
    const c2 = await loadConfig(out);
    expect(c2.scope.decisions[join(scan, "q1")]).toMatchObject({ decision: "exclude", by: "user" });
    expect(Object.keys(c2.scope.questions)).toHaveLength(2);
    await call("POST", "/api/settings/scope-reset", { path: join(scan, "z") });
    expect(Object.keys((await loadConfig(out)).scope.questions)).toEqual([join(scan, "q2")]);
  });

  it("scope-reset removes the path and its children only", async () => {
    const { scan, out, call } = await normal();
    const r = await call("POST", "/api/settings/scope-reset", { path: join(scan, "a") });
    expect(r.json).toEqual({ ok: true, removed: 2 });
    expect(Object.keys((await loadConfig(out)).scope.decisions)).toEqual([join(scan, "c")]);
    expect((await call("POST", "/api/settings/scope-reset", {})).status).toBe(400);
  });
});
