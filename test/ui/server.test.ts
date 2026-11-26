import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { join, resolve } from "node:path";
import { mkTmp } from "../helpers/tmp.js";
import { seedCards } from "../helpers/cards.js";
import { runGroup } from "../../src/commands/group.js";
import { runUi } from "../../src/commands/ui.js";
import { startUiServer } from "../../src/ui/server.js";
import { listExperiences } from "../../src/store/experiences.js";
import { loadState } from "../../src/store/state.js";

const TOKEN = "t".repeat(64);
const dirs: string[] = [];
const closers: (() => Promise<void>)[] = [];

async function setup(cliPath = "unused.js", onShutdown?: () => void) {
  const out = await mkTmp("mp-out-"); dirs.push(out); process.env.MP_OUTPUT_DIR = out;
  await seedCards(out, [{ title: "보고서" }, { title: "발표" }], "group-one");
  await runGroup({ yes: true });
  const srv = await startUiServer({ out, token: TOKEN, cliPath, html: (t) => `<!doctype html><title>x</title>${t}`, onShutdown });
  closers.push(srv.close);
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = { "x-mp-token": TOKEN }) => {
    const r = await fetch(`http://127.0.0.1:${srv.port}${path}`, { method, headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
    const text = await r.text();
    let json: any = null; try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, json, text, headers: r.headers };
  };
  const exps = async () => { const { state } = await loadState(out); return listExperiences(out, state); };
  return { out, srv, call, exps };
}

describe("mp ui server (11.5)", () => {
  beforeEach(() => { vi.spyOn(console, "log").mockImplementation(() => {}); });
  afterEach(async () => {
    vi.restoreAllMocks(); delete process.env.MP_OUTPUT_DIR;
    await Promise.all(closers.splice(0).map((c) => c()));
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  it("checks token and Host; no CORS headers", async () => {
    const { srv, call } = await setup();
    expect((await call("GET", "/api/state", undefined, {})).status).toBe(401);
    expect((await call("GET", "/api/state", undefined, { "x-mp-token": "short" })).status).toBe(401);
    const bad = await new Promise<number>((ok, fail) => {
      const r = request({ host: "127.0.0.1", port: srv.port, path: "/api/state", headers: { host: "evil.com", "x-mp-token": TOKEN } }, (res) => { res.resume(); ok(res.statusCode!); });
      r.on("error", fail); r.end();
    });
    expect(bad).toBe(403);
    const good = await call("GET", "/api/state");
    expect(good.status).toBe(200);
    expect(good.headers.get("access-control-allow-origin")).toBeNull();
    expect(good.json.experiences).toHaveLength(1);
    expect(good.json.experiences[0]).toMatchObject({ review: "pending", title: "하나의 경험", pending_apply: false, edited: false, keywords: ["역분석", "입력 복원"], outcome_keywords: ["키 복원"] });
    expect(good.json.job).toBeNull();
  });

  it("page: ?t= sets an HttpOnly SameSite cookie and redirects to a clean URL; / needs the cookie; APIs ignore the cookie", async () => {
    const { srv } = await setup();
    const base = `http://127.0.0.1:${srv.port}`;
    const bad = await fetch(`${base}/?t=bad`, { redirect: "manual" });
    expect(bad.status).toBe(401);
    expect(await bad.text()).toContain("바로가기로 열어 주세요");
    expect((await fetch(`${base}/`, { redirect: "manual" })).status).toBe(401);
    const r = await fetch(`${base}/?t=${TOKEN}`, { redirect: "manual" });
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("/");
    const cookie = r.headers.get("set-cookie")!;
    expect(cookie).toMatch(/^mp_t=[^;]+; HttpOnly; SameSite=Strict; Path=\/; Max-Age=\d+$/);
    const page = await fetch(`${base}/`, { headers: { cookie: cookie.split(";")[0] } });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain(TOKEN);
    expect(page.headers.get("cache-control")).toBe("no-store");
    expect((await fetch(`${base}/`, { headers: { cookie: "mp_t=" + "0".repeat(64) } })).status).toBe(401);
    // 쿠키만으로는 API를 부를 수 없다(헤더 필요)
    expect((await fetch(`${base}/api/state`, { headers: { cookie: cookie.split(";")[0] } })).status).toBe(401);
    expect((await fetch(`${base}/api/decide`, { method: "POST", headers: { cookie: cookie.split(";")[0], "content-type": "application/json" }, body: "{}" })).status).toBe(401);
  });

  it("ping answers without auth: app, version, token id (not the token), busy", async () => {
    const { srv } = await setup();
    const j = await (await fetch(`http://127.0.0.1:${srv.port}/api/ping`)).json();
    expect(j).toMatchObject({ app: "MasterPortfolio", version: "dev", busy: false });
    expect(j.id).toHaveLength(12);
    expect(JSON.stringify(j)).not.toContain(TOKEN);
  });

  it("master.md·master.html are rebuilt automatically after a decision (debounced), so master is never stale", async () => {
    const { out, call, exps } = await setup();
    const rel = (await exps())[0].rel;
    expect((await call("POST", "/api/decide", { rels: [rel], decision: "adopted" })).status).toBe(200);
    let md = "";
    for (let i = 0; i < 100; i++) { try { md = await readFile(join(out, "master.md"), "utf8"); } catch { /* 아직 */ } if (md.includes("보고서") || md.includes("발표")) break; await new Promise((r) => setTimeout(r, 50)); }
    expect(md).not.toContain("채택된 경험이 없습니다");
    expect(await readFile(join(out, "master.html"), "utf8")).toContain("Master Record");
  });

  it("decide, answer (masked), edit (clamped, strict)", async () => {
    const { call, exps } = await setup();
    const rel = (await exps())[0].rel;
    expect((await call("POST", "/api/decide", { rels: [rel], decision: "adopted" })).status).toBe(200);
    expect((await exps())[0].fm.review).toBe("adopted");
    expect((await call("POST", "/api/decide", { rels: ["experiences/none.md"], decision: "held" })).status).toBe(404);
    expect((await call("POST", "/api/decide", { rels: [rel], decision: "bogus" })).status).toBe(400);

    const [e0] = await exps();
    const qid = e0.fm.questions[0].id;
    expect((await call("POST", "/api/answer", { rel, qid: "nope", a: "x" })).status).toBe(404);
    expect((await call("POST", "/api/answer", { rel, qid, a: "팀장 010-1234-5678" })).status).toBe(200);
    const [e1] = await exps();
    expect(e1.fm.questions[0].a).toBe("팀장 [전화번호]");
    expect(e1.fm.pending_apply).toBe(true);

    const long = "가".repeat(20);
    expect((await call("POST", "/api/edit", { rel, fields: { contribution: "AI 주도", keywords: [long, "b", "c", "d"], team_size: 3 } })).status).toBe(200);
    const [e2] = await exps();
    expect(e2.fm.contribution).toBe("AI 주도");
    expect(e2.fm.keywords).toEqual(["가".repeat(18), "b", "c"]);
    expect(e2.fm.team_size).toBe(3);
    expect((await call("POST", "/api/edit", { rel, fields: { review: "adopted" } })).status).toBe(400);
    expect((await call("POST", "/api/edit", { rel, fields: { contribution: "없는값" } })).status).toBe(400);
    expect((await exps())[0].fm.review).toBe("adopted");
  });

  it("409 for externally edited cards, until accept-edit", async () => {
    const { out, call, exps } = await setup();
    const rel = (await exps())[0].rel;
    const path = join(out, rel);
    const edited = (await readFile(path, "utf8")) + "\n내 메모\n";
    await writeFile(path, edited);
    for (const [p, b] of [["/api/decide", { rels: [rel], decision: "adopted" }], ["/api/edit", { rel, fields: { title: "새 제목" } }], ["/api/answer", { rel, qid: "q1", a: "x" }]] as const) {
      const r = await call("POST", p, b);
      expect(r.status, p).toBe(409);
    }
    expect(await readFile(path, "utf8")).toBe(edited);
    expect((await call("GET", "/api/state")).json.experiences[0].edited).toBe(true);
    expect((await call("POST", "/api/accept-edit", { rel })).status).toBe(200);
    expect((await call("POST", "/api/decide", { rels: [rel], decision: "held" })).status).toBe(200);
    expect((await exps())[0].fm.review).toBe("held");
  });

  it("decide returns only the edited ones as 409 and saves the rest", async () => {
    const { out, call, exps } = await setup();
    const [a] = await exps();
    // 두 번째 경험 카드를 복제해 만든다
    const text = await readFile(join(out, a.rel), "utf8");
    const second = "experiences/zz-copy.md";
    await writeFile(join(out, second), text);
    const { state } = await loadState(out);
    const { acceptExperienceEdit } = await import("../../src/store/experiences.js");
    const { saveState } = await import("../../src/store/state.js");
    const all = await listExperiences(out, state);
    await acceptExperienceEdit(out, state, all.find((x) => x.rel === second)!);
    await saveState(out, state);
    await writeFile(join(out, a.rel), text + "\n편집\n");
    const r = await call("POST", "/api/decide", { rels: [a.rel, second], decision: "excluded" });
    expect(r.status).toBe(409);
    expect(r.json.edited).toEqual([a.rel]);
    expect(r.json.saved).toEqual([second]);
    expect((await exps()).find((x) => x.rel === second)!.fm.review).toBe("excluded");
  });

  it("500 with the corrupt-state message", async () => {
    const { out, call } = await setup();
    await writeFile(join(out, ".mp", "state.json"), "{broken");
    const r = await call("GET", "/api/state");
    expect(r.status).toBe(500);
    expect(r.json.error).toContain("state.json 손상");
  });

  it("/files rejects traversal and non-existent, serves existing cards as text/plain", async () => {
    const { srv, call, exps, out } = await setup();
    const raw = (path: string) => new Promise<number>((ok, fail) => {
      const r = request({ host: "127.0.0.1", port: srv.port, path, headers: { "x-mp-token": TOKEN } }, (res) => { res.resume(); ok(res.statusCode!); });
      r.on("error", fail); r.end();
    });
    await mkdir(join(out, ".mp"), { recursive: true }); await writeFile(join(out, ".mp", "x.md"), "secret"); await writeFile(join(out, "master.md"), "m");
    for (const p of ["/files/../.mp/config.json", "/files/%2e%2e/x.md", "/files/files/none.md", "/files/../.mp/x.md", "/files/..%2fmaster.md", "/files/%2e%2e%2f.mp%2fx.md", "/files/files/card-0.txt", "/files/%00.md", "/files/%zz"]) {
      expect(await raw(p), p).toBe(404);
    }
    const f = await call("GET", "/files/files/card-0.md");
    expect(f.status).toBe(200);
    expect(f.headers.get("content-type")).toContain("text/plain");
    expect((await call("GET", `/files/${(await exps())[0].rel}`)).status).toBe(200);
    expect((await call("GET", "/files/files/card-0.md", undefined, {})).status).toBe(401);
  });

  it("limits body to 1MB (413) and rejects non-JSON (400)", async () => {
    const { call } = await setup();
    expect((await call("POST", "/api/decide", "x".repeat(1024 * 1024 + 10))).status).toBe(413);
    expect((await call("POST", "/api/decide", "{nope")).status).toBe(400);
    expect((await call("POST", "/api/decide", "[1]")).status).toBe(400);
  });

  it("shutdown calls onShutdown; scan and group are allowed job kinds", async () => {
    let down = 0;
    const dir = await mkTmp("mp-stub-"); dirs.push(dir);
    const stub = join(dir, "stub.mjs");
    await writeFile(stub, `console.log("args " + process.argv.slice(2).join(" "));`);
    const { call } = await setup(stub, () => { down++; });
    for (const kind of ["scan", "group"]) {
      expect((await call("POST", "/api/job", { kind })).status).toBe(200);
      let job: any;
      for (let i = 0; i < 100; i++) { job = (await call("GET", "/api/job")).json.job; if (!job.running) break; await new Promise((r) => setTimeout(r, 30)); }
      expect(job.lines.join(" ")).toContain(`args ${kind} --yes`);
    }
    expect((await call("POST", "/api/shutdown", {}, {})).status).toBe(401);
    expect((await call("POST", "/api/shutdown", {})).status).toBe(200);
    await new Promise((r) => setTimeout(r, 120));
    expect(down).toBe(1);
  });

  it("job progress: @@progress lines become job.progress (with overall %) and stay out of the log", async () => {
    const dir = await mkTmp("mp-stub-"); dirs.push(dir);
    const stub = join(dir, "stub.mjs");
    await writeFile(stub, `if (process.env.MP_PROGRESS !== "1") process.exit(9); console.log("시작"); console.log('@@progress {"stage":"extract","done":3,"total":6}'); console.log("@@progress {bad"); setTimeout(() => process.exit(0), 300);`);
    const { call } = await setup(stub);
    expect((await call("POST", "/api/job", { kind: "scan" })).status).toBe(200);
    let job: any;
    for (let i = 0; i < 100; i++) { job = (await call("GET", "/api/job")).json.job; if (job.progress || !job.running) break; await new Promise((r) => setTimeout(r, 30)); }
    expect(job.progress).toMatchObject({ stage: "extract", done: 3, total: 6 });
    expect(job.progress.overall).toBeCloseTo(0.575);
    for (let i = 0; i < 100; i++) { job = (await call("GET", "/api/job")).json.job; if (!job.running) break; await new Promise((r) => setTimeout(r, 30)); }
    expect(job.code).toBe(0);
    expect(job.lines).toEqual(["시작"]);
    expect(job.summary).toBe("시작"); // @@summary가 없으면 마지막 표준 출력 줄
  });

  it("job summary: @@summary wins over the last line; overall % never goes backwards", async () => {
    const dir = await mkTmp("mp-stub-"); dirs.push(dir);
    const stub = join(dir, "stub.mjs");
    await writeFile(stub, `console.log('@@progress {"stage":"hash","done":10,"total":10}'); setTimeout(() => { console.log('@@progress {"stage":"walk","done":400,"total":0}'); console.log("@@summary 새로 분석할 자료 없음 · 크기 초과 1개"); console.log("끝 줄"); setTimeout(() => process.exit(0), 200); }, 200);`);
    const { call } = await setup(stub);
    await call("POST", "/api/job", { kind: "scan" });
    let job: any, seen: number[] = [];
    for (let i = 0; i < 100; i++) { job = (await call("GET", "/api/job")).json.job; if (job.progress?.overall != null) seen.push(job.progress.overall); if (!job.running) break; await new Promise((r) => setTimeout(r, 25)); }
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    expect(job.summary).toBe("새로 분석할 자료 없음 · 크기 초과 1개");
  });

  it("all: runs scan → group → apply → keywords → master in order, collects summaries, and stops at the first failure", async () => {
    const dir = await mkTmp("mp-stub-"); dirs.push(dir);
    const stub = join(dir, "stub.mjs");
    await writeFile(stub, `const k = process.argv[2]; console.log("step " + k); console.log("@@summary " + k + " ok"); process.exit(process.env.FAIL_AT === k ? 5 : 0);`);
    const { call } = await setup(stub);
    const wait = async () => { let job: any; for (let i = 0; i < 200; i++) { job = (await call("GET", "/api/job")).json.job; if (!job.running) break; await new Promise((r) => setTimeout(r, 30)); } return job; };
    expect((await call("POST", "/api/job", { kind: "all" })).status).toBe(200);
    let job = await wait();
    expect(job.code).toBe(0);
    expect(job.lines.filter((l: string) => l.startsWith("step "))).toEqual(["step scan", "step group", "step review", "step keywords", "step master"]);
    expect(job.summary).toBe("스캔: scan ok / 묶기: group ok / 반영: review ok / 키워드: keywords ok / master: master ok");
    expect(job.progress.overall).toBe(1);
    process.env.FAIL_AT = "group";
    try {
      await call("POST", "/api/job", { kind: "all" });
      job = await wait();
    } finally { delete process.env.FAIL_AT; }
    expect(job.code).toBe(5);
    expect(job.lines.filter((l: string) => l.startsWith("step "))).toEqual(["step scan", "step group"]);
    expect(job.summary).toContain("묶기: 실패(코드 5)");
  });

  it("stop: ends the job and its child processes (agent tree), reports stopped, and 409 when nothing runs", async () => {
    const dir = await mkTmp("mp-stub-"); dirs.push(dir);
    const stub = join(dir, "stub.mjs");
    // 에이전트 어댑터처럼 손자 프로세스를 띄우고 그 pid를 알린 뒤 계속 실행
    await writeFile(stub, `import { spawn } from "node:child_process"; const g = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" }); console.log("grandchild " + g.pid); setInterval(() => {}, 1000);`);
    const { call } = await setup(stub);
    expect((await call("POST", "/api/job/stop", {})).status).toBe(409);
    await call("POST", "/api/job", { kind: "scan" });
    let job: any, gpid = 0;
    for (let i = 0; i < 100 && !gpid; i++) { job = (await call("GET", "/api/job")).json.job; const l = job.lines.find((x: string) => x.startsWith("grandchild ")); if (l) gpid = Number(l.split(" ")[1]); else await new Promise((r) => setTimeout(r, 30)); }
    expect(gpid).toBeGreaterThan(0);
    const st = await call("POST", "/api/job/stop", {});
    expect(st.status).toBe(200);
    expect(st.json.job.stopped).toBe(true);
    for (let i = 0; i < 200; i++) { job = (await call("GET", "/api/job")).json.job; if (!job.running) break; await new Promise((r) => setTimeout(r, 30)); }
    expect(job.running).toBe(false);
    expect(job.summary).toContain("중지");
    const alive = () => { try { process.kill(gpid, 0); return true; } catch { return false; } };
    for (let i = 0; i < 100 && alive(); i++) await new Promise((r) => setTimeout(r, 30));
    expect(alive()).toBe(false);
  });

  it("job: runs a child, keeps the last 200 lines, and rejects a second start with 409", async () => {
    const dir = await mkTmp("mp-stub-"); dirs.push(dir);
    const stub = join(dir, "stub.mjs");
    await writeFile(stub, `for (let i=0;i<250;i++) console.log("line "+i); console.error("err "+process.argv.slice(2).join(" ")+" "+process.env.MP_OUTPUT_DIR); setTimeout(()=>process.exit(3), 400);`);
    const { call, out } = await setup(stub);
    const a = await call("POST", "/api/job", { kind: "keywords" });
    expect(a.status).toBe(200);
    expect(a.json.job.running).toBe(true);
    expect((await call("POST", "/api/job", { kind: "master" })).status).toBe(409);
    expect((await call("POST", "/api/job", { kind: "rm -rf" })).status).toBe(409);
    const blocked = await call("POST", "/api/decide", { rels: [], decision: "held" });
    expect(blocked.status).toBe(409);
    expect(blocked.json.error).toContain("작업 실행 중");
    let job: any;
    for (let i = 0; i < 100; i++) { job = (await call("GET", "/api/job")).json.job; if (!job.running) break; await new Promise((r) => setTimeout(r, 50)); }
    expect(job.running).toBe(false);
    expect(job.code).toBe(3);
    expect(job.lines.length).toBeLessThanOrEqual(200);
    expect(job.lines.some((l: string) => l.includes(`keywords --yes ${out}`))).toBe(true);
    expect((await call("POST", "/api/job", { kind: "bogus" })).status).toBe(400);
  });

  it("job master (real CLI via tsx) writes master.html", async () => {
    const { call, out } = await setup(resolve("src/cli.ts"));
    const loader = new URL("../../node_modules/tsx/dist/loader.mjs", import.meta.url).href;
    const prev = process.env.NODE_OPTIONS;
    process.env.NODE_OPTIONS = `--import ${loader}`;
    try {
      expect((await call("POST", "/api/job", { kind: "master" })).status).toBe(200);
      let job: any;
      for (let i = 0; i < 200; i++) { job = (await call("GET", "/api/job")).json.job; if (!job.running) break; await new Promise((r) => setTimeout(r, 100)); }
      expect(job.code, job.lines.join("\n")).toBe(0);
      expect((await readFile(join(out, "master.html"), "utf8")).length).toBeGreaterThan(100);
    } finally { if (prev === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = prev; }
  });

  it("runUi prints the URL and serves with an injected cliPath", async () => {
    const out = await mkTmp("mp-out-"); dirs.push(out); process.env.MP_OUTPUT_DIR = out;
    const r = await runUi({ open: false, cliPath: "unused.js" });
    closers.push(r.close!);
    expect(r.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/\?t=[0-9a-f]{64}$/);
    expect((await fetch(r.url!, { redirect: "manual" })).status).toBe(302);
  });
});
