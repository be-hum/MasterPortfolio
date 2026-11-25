import { describe, it, expect } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { AcpBridge, AgentError } from "../../src/agent/bridge.js";
import { mkTmp } from "../helpers/tmp.js";

const FAKE = resolve("test/fake-agent/fake-agent.ts");
// 에이전트는 빈 임시 폴더에서 실행되므로 `--import tsx`를 cwd 기준으로 풀 수 없다 → 절대 URL로 지정
const TSX = pathToFileURL(resolve("node_modules/tsx/dist/loader.mjs")).href;
const cfg = (env: Record<string, string>, extra: object = {}) => ({ command: process.execPath, args: ["--import", TSX, FAKE], env, ...extra });
const readLog = async (p: string) => (await readFile(p, "utf8")).trim().split("\n").map((l) => JSON.parse(l));

describe("AcpBridge", () => {
  it("collects message chunks as reply text", async () => {
    const b = new AcpBridge(cfg({ FAKE_AGENT_SCENARIO: "ok" }));
    await b.start();
    const s = await b.newSession();
    const r = await b.prompt(s, "### FILE id=f1\n내용", 30_000);
    await b.stop();
    expect(r.ok && JSON.parse(r.text)[0].id).toBe("f1");
  });

  it("spawns in an empty temp dir, passes sessionMeta as _meta, and sets the initial mode", async () => {
    const d = await mkTmp(); const log = join(d, "log.jsonl");
    const meta = { claudeCode: { options: { tools: [] } } };
    const b = new AcpBridge(cfg({ FAKE_AGENT_SCENARIO: "ok", FAKE_AGENT_LOG: log }, { sessionMeta: meta, initialModeId: "default" }));
    await b.start(); await b.newSession();
    const lines = await readLog(log);
    const processCwd = lines.find((l) => l.processCwd)!.processCwd as string;
    const sessionNew = lines.find((l) => l.sessionNew)!.sessionNew;
    expect(processCwd).not.toBe(process.cwd());
    expect(sessionNew.cwd).toBe(processCwd);
    expect(sessionNew._meta).toEqual(meta);
    expect(lines.find((l) => l.setMode)?.setMode).toBe("default");
    expect(await readdir(processCwd)).toEqual([]);
    await b.stop();
    expect(existsSync(processCwd)).toBe(false);
  });

  it("rejects every permission request", async () => {
    const d = await mkTmp(); const log = join(d, "log.jsonl");
    const b = new AcpBridge(cfg({ FAKE_AGENT_SCENARIO: "permission", FAKE_AGENT_LOG: log }));
    await b.start(); const s = await b.newSession();
    await b.prompt(s, "### FILE id=f1\n내용", 30_000);
    await b.stop();
    const outcome = (await readLog(log)).find((l) => l.permissionOutcome)!.permissionOutcome;
    expect(outcome).toEqual({ outcome: "selected", optionId: "reject" });
    expect(b.deniedPermissions).toBe(1);
  });

  it("maps a thrown agent error to rate_limit", async () => {
    const d = await mkTmp();
    const b = new AcpBridge(cfg({ FAKE_AGENT_SCENARIO: "rate-limit-after-1", FAKE_AGENT_STATE: join(d, "n") }));
    await b.start(); const s = await b.newSession();
    expect((await b.prompt(s, "### FILE id=a\n", 30_000)).ok).toBe(true);
    expect(await b.prompt(s, "### FILE id=b\n", 30_000)).toMatchObject({ ok: false, kind: "rate_limit" });
    await b.stop();
  });

  it("throws AgentError(auth) when session/new requires authentication", async () => {
    const b = new AcpBridge(cfg({ FAKE_AGENT_SCENARIO: "auth-on-new" }));
    await b.start();
    await expect(b.newSession()).rejects.toMatchObject({ kind: "auth" });
    await b.stop();
  });

  it("throws AgentError(crash) when the agent exits before answering", async () => {
    const b = new AcpBridge({ command: process.execPath, args: ["-e", "process.exit(3)"] });
    const err = await b.start().then(() => null, (e) => e);
    expect(err).toBeInstanceOf(AgentError);
    expect(err.kind).toBe("crash");
    await b.stop();
  });

  it("returns a crash reply instead of throwing when prompting after stop", async () => {
    const b = new AcpBridge(cfg({ FAKE_AGENT_SCENARIO: "ok" }));
    await b.start(); const s = await b.newSession(); await b.stop();
    expect(await b.prompt(s, "x", 1000)).toMatchObject({ ok: false, kind: "crash" });
  });

  it("throws AgentError(crash) when the agent command does not exist, and removes its work dir", async () => {
    // 다른 테스트 파일도 병렬로 mp-agent-* 폴더를 만들므로 이 브리지의 작업 폴더만 확인한다
    const logged: string[] = [];
    const b = new AcpBridge({ command: "definitely-not-a-real-cmd-xyz", args: [] }, { log: (l) => logged.push(l) });
    const err = await b.start().then(() => null, (e) => e);
    const workDir = logged.map((l) => l.match(/^\[workdir\] (.+)$/)?.[1]).find(Boolean);
    expect(workDir).toBeTruthy();
    expect(existsSync(workDir!)).toBe(false);
    expect(err).toBeInstanceOf(AgentError);
    expect(err.kind).toBe("crash");
    await b.stop();
  });

  it("removes its work dir when the agent starts but exits before the handshake (Windows cmd.exe for a missing command)", async () => {
    const logged: string[] = [];
    const b = new AcpBridge({ command: process.execPath, args: ["-e", "process.exit(1)"] }, { log: (l) => logged.push(l) });
    const err = await b.start().then(() => null, (e) => e);
    const workDir = logged.map((l) => l.match(/^\[workdir\] (.+)$/)?.[1]).find(Boolean);
    expect(err).toBeInstanceOf(AgentError);
    expect(existsSync(workDir!)).toBe(false);
    await b.stop();
  });

  it("does not leak a timed-out turn's late chunks into the next turn", async () => {
    const d = await mkTmp(); const log = join(d, "log.jsonl");
    const b = new AcpBridge(cfg({ FAKE_AGENT_SCENARIO: "slow", FAKE_AGENT_STATE: join(d, "n"), FAKE_AGENT_LOG: log }));
    await b.start(); const s = await b.newSession();
    expect(await b.prompt(s, "### FILE id=old\n", 200)).toMatchObject({ ok: false, kind: "timeout" });
    const r = await b.prompt(s, "### FILE id=new\n", 30_000);
    await b.stop();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.text).not.toContain("OLD_TURN_CHUNK");
      expect(JSON.parse(r.text)[0].id).toBe("new");
    }
    expect((await readLog(log)).some((l) => l.cancel === s)).toBe(true);
  });

  it("marks a session unusable when a cancelled turn never settles", async () => {
    const d = await mkTmp();
    const b = new AcpBridge(cfg({ FAKE_AGENT_SCENARIO: "hang", FAKE_AGENT_STATE: join(d, "n") }), { cancelGraceMs: 200 });
    await b.start(); const s = await b.newSession();
    expect(await b.prompt(s, "### FILE id=a\n", 200)).toMatchObject({ ok: false, kind: "timeout" });
    expect(await b.prompt(s, "### FILE id=b\n", 30_000)).toMatchObject({ ok: false, kind: "crash" });
    const s2 = await b.newSession();
    expect((await b.prompt(s2, "### FILE id=c\n", 30_000)).ok).toBe(true);
    await b.stop();
  });

  it("force-kills an agent that ignores stdin EOF and still removes the work dir", async () => {
    const b = new AcpBridge({ command: process.execPath, args: ["-e", "process.stdin.resume(); process.stdin.on('end', () => {}); setInterval(() => {}, 1000)"] }, { stopGraceMs: 200 });
    // initialize는 응답되지 않으므로 start()를 기다리지 않는다
    const started = b.start().catch((e) => e);
    await new Promise((r) => setTimeout(r, 200));
    // 다른 테스트 파일도 병렬로 mp-agent-* 폴더를 만들므로 이 브리지의 작업 폴더만 확인한다
    const workDir = (b as unknown as { workDir: string | null }).workDir;
    expect(workDir && existsSync(workDir)).toBe(true);
    const t0 = Date.now();
    await b.stop();
    expect(Date.now() - t0).toBeLessThan(3_000);
    expect(await started).toMatchObject({ kind: "crash" });
    expect(existsSync(workDir!)).toBe(false);
  });

  it("times out an agent that never answers initialize", async () => {
    const b = new AcpBridge(cfg({ FAKE_AGENT_SCENARIO: "hang-initialize" }), { handshakeTimeoutMs: 300, stopGraceMs: 200 });
    const t0 = Date.now();
    const e = await b.start().catch((x) => x);
    await b.stop();
    expect(e).toBeInstanceOf(AgentError);
    expect(e).toMatchObject({ kind: "timeout" });
    expect(e.message).toContain("initialize");
    expect(Date.now() - t0).toBeLessThan(10_000);
  });

  it("times out an agent that never answers session/new", async () => {
    const b = new AcpBridge(cfg({ FAKE_AGENT_SCENARIO: "hang-session-new" }), { handshakeTimeoutMs: 3000, stopGraceMs: 200 });
    await b.start();
    const e = await b.newSession().catch((x) => x);
    await b.stop();
    expect(e).toMatchObject({ kind: "timeout" });
    expect(e.message).toContain("session/new");
  });
});

describe("AcpBridge usage (§9.8)", () => {
  it("surfaces prompt usage tokens and keeps the latest five-hour utilization per bridge", async () => {
    const d = await mkTmp();
    const b = new AcpBridge(cfg({ FAKE_AGENT_SCENARIO: "ok", FAKE_AGENT_UTIL_FILE: join(d, "util"), FAKE_AGENT_UTIL_START: "0.30", FAKE_AGENT_UTIL_STEP: "0.07" }));
    await b.start();
    expect(b.fiveHour).toBeNull();
    const r = await b.prompt(await b.newSession(), "### FILE id=f1\n내용", 30_000);
    expect(r.ok && r.usage).toEqual({ inputTokens: expect.any(Number), outputTokens: expect.any(Number), cachedReadTokens: 7, cachedWriteTokens: 3, totalTokens: expect.any(Number) });
    expect(b.fiveHour).toEqual({ utilization: 0.37, resetsAt: 1795507800 });
    await b.prompt(await b.newSession(), "### FILE id=f2\n내용", 30_000);
    expect(b.fiveHour).toEqual({ utilization: 0.44, resetsAt: 1795507800 });
    await b.stop();
  });

  it("has no usage or utilization when the agent sends none", async () => {
    const b = new AcpBridge(cfg({ FAKE_AGENT_SCENARIO: "ok" }));
    await b.start();
    await b.prompt(await b.newSession(), "### FILE id=f1\n내용", 30_000);
    expect(b.fiveHour).toBeNull();
    await b.stop();
  });
});
