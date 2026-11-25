import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import type { AgentConfig } from "../core/schema.js";
import { classifyRpcError, describeError } from "./classify.js";
import { parseFiveHour, parseTokenUsage, type FiveHour, type TokenUsage } from "./usage.js";

export type AgentFailureKind = "rate_limit" | "auth" | "crash" | "timeout" | "other";
/** usage: session/prompt 응답의 토큰 사용량(있을 때만, 9.8) */
export type AgentReply = { ok: true; text: string; usage?: TokenUsage } | { ok: false; kind: AgentFailureKind; detail: string };

export class AgentError extends Error {
  constructor(readonly kind: AgentFailureKind, detail: string) { super(detail); this.name = "AgentError"; }
}

export type SpawnPlan = { file: string; args: string[]; shell: false; windowsVerbatimArguments: boolean };

// cross-spawn과 같은 cmd.exe 메타문자 집합(공백 포함: ^로 이스케이프하면 cmd의 따옴표 상태가 바뀌지 않는다)
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;
const escapeCmdCommand = (cmd: string) => cmd.replace(CMD_META, "^$1");
function escapeCmdArg(arg: string, doubleEscape: boolean): string {
  let a = arg.replace(/(\\*)"/g, '$1$1\\"'); // 따옴표 앞 백슬래시를 두 배로 + 따옴표 이스케이프
  a = a.replace(/(\\*)$/, "$1$1"); // 닫는 따옴표 앞 백슬래시를 두 배로
  a = `"${a}"`.replace(CMD_META, "^$1");
  return doubleEscape ? a.replace(CMD_META, "^$1") : a;
}

/** shell 없이 에이전트를 실행할 방법을 정한다(Windows의 .cmd 셰임 포함). 순수 함수. */
export function resolveSpawn(
  command: string, args: string[], platform: NodeJS.Platform = process.platform,
  execPath: string = process.execPath, exists: (p: string) => boolean = existsSync,
): SpawnPlan {
  if (platform !== "win32") return { file: command, args, shell: false, windowsVerbatimArguments: false };
  const lower = command.toLowerCase();
  if (lower === "npx" || lower === "npx.cmd") {
    const cli = path.win32.join(path.win32.dirname(execPath), "node_modules", "npm", "bin", "npx-cli.js");
    if (exists(cli)) return { file: execPath, args: [cli, ...args], shell: false, windowsVerbatimArguments: false };
  }
  if (command === execPath || /\.exe$/i.test(command)) return { file: command, args, shell: false, windowsVerbatimArguments: false };
  // 배치 파일은 %*를 다시 해석하므로 메타문자를 두 번 이스케이프한다(cross-spawn의 cmd-shim 처리와 동일)
  const doubleEscape = /\.(cmd|bat)$/i.test(command);
  const line = [escapeCmdCommand(command), ...args.map((a) => escapeCmdArg(a, doubleEscape))].join(" ");
  return { file: process.env.ComSpec ?? "cmd.exe", args: ["/d", "/s", "/c", `"${line}"`], shell: false, windowsVerbatimArguments: true };
}

type Conn = ReturnType<ReturnType<typeof acp.client>["connect"]>;

const TIMED_OUT = Symbol("timeout");
async function within<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: NodeJS.Timeout | undefined;
  const t = new Promise<typeof TIMED_OUT>((res) => { timer = setTimeout(() => res(TIMED_OUT), ms); });
  try { return await Promise.race([p, t]); } finally { clearTimeout(timer); }
}

export type BridgeOptions = {
  log?: (line: string) => void;
  /** 타임아웃 후 cancel을 보내고 이전 턴이 끝나기를 기다리는 시간 */
  cancelGraceMs?: number;
  /** stop()에서 stdin을 닫은 뒤 프로세스 종료를 기다리는 시간 */
  stopGraceMs?: number;
  /** initialize·session/new 응답을 기다리는 시간 (기본 60초) */
  handshakeTimeoutMs?: number;
};

export class AcpBridge {
  private proc: ChildProcess | null = null;
  private conn: Conn | null = null;
  private workDir: string | null = null;
  /** 현재 진행 중인 턴의 버퍼. 알림은 여기에만 쌓인다(이전 턴의 늦은 청크가 다음 턴에 섞이지 않음). */
  private active = new Map<string, string[]>();
  /** 취소 후에도 끝나지 않은 턴이 남은 세션 */
  private broken = new Set<string>();
  private exited: string | null = null;
  deniedPermissions = 0;
  /**
   * 마지막으로 받은 5시간 사용량 창(9.8). 세션이 아니라 브리지(프로세스) 단위로 둔다:
   * 알림이 prompt 응답보다 먼저 오거나 다른 세션에서 와도 배치 뒤 점검에서 최신 값을 본다.
   */
  fiveHour: FiveHour | null = null;

  constructor(private cfg: AgentConfig, private opts: BridgeOptions = {}) {}

  /** 핸드셰이크 요청을 시간 제한과 함께 기다린다. 시간 초과 시 AgentError("timeout"). */
  private async handshake<T>(what: string, req: Promise<T>): Promise<T> {
    req.catch(() => {}); // 시간 초과 뒤 늦게 실패해도 처리되지 않은 거부가 되지 않게 한다
    const ms = this.opts.handshakeTimeoutMs ?? 60_000;
    let r: T | typeof TIMED_OUT;
    try { r = await within(req, ms); } catch (e) { throw this.fail(e); }
    if (r === TIMED_OUT) {
      this.opts.log?.(`[${what}] timeout after ${ms}ms`);
      throw new AgentError("timeout", `에이전트가 ${what}에 ${Math.round(ms / 1000)}초 안에 응답하지 않음`);
    }
    return r;
  }

  private isDead(): boolean {
    const p = this.proc;
    return Boolean(this.conn?.signal.aborted || (p && (p.exitCode !== null || p.signalCode !== null)));
  }

  private fail(e: unknown): AgentError {
    if (e instanceof AgentError) return e;
    if (this.exited) return new AgentError("crash", this.exited);
    if (this.isDead()) return new AgentError("crash", `에이전트 연결 종료: ${describeError(e)}`);
    // 추가 안전망: SDK는 연결이 끊기면 이 메시지로 reject한다
    if (e instanceof Error && e.message === "ACP connection closed") return new AgentError("crash", `에이전트 연결 종료: ${e.message}`);
    return new AgentError(classifyRpcError(e), describeError(e));
  }

  async start(): Promise<void> {
    // 실제 경로로: macOS의 /var는 /private/var 링크라, 에이전트가 보는 cwd와 session/new의 cwd가 어긋나지 않게
    this.workDir = await realpath(await mkdtemp(join(tmpdir(), "mp-agent-")));
    this.opts.log?.(`[workdir] ${this.workDir}`);
    const plan = resolveSpawn(this.cfg.command, this.cfg.args);
    const proc = spawn(plan.file, plan.args, {
      cwd: this.workDir, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ...(this.cfg.env ?? {}) },
      windowsHide: true, shell: false, windowsVerbatimArguments: plan.windowsVerbatimArguments,
    });
    this.proc = proc;
    try {
      await new Promise<void>((res, rej) => { proc.once("spawn", () => res()); proc.once("error", rej); });
    } catch (e) {
      this.proc = null;
      await this.removeWorkDir();
      throw new AgentError("crash", `에이전트 실행 실패: ${describeError(e)}`);
    }
    // 시작 뒤 연결 단계에서 실패해도(예: Windows에서 없는 명령은 cmd.exe가 뜬 뒤 종료) 프로세스를 끄고 작업 폴더를 지운다
    try { await this.connect(proc); }
    catch (e) { await this.stop(); throw e; }
  }

  private async connect(proc: ChildProcess): Promise<void> {
    proc.on("exit", (code, signal) => { this.exited = `에이전트 프로세스 종료 (code ${code}${signal ? `, ${signal}` : ""})`; });
    proc.stdin?.on("error", (e) => this.opts.log?.(`[agent stdin] ${describeError(e)}`));
    proc.stderr?.on("data", (d) => this.opts.log?.(`[agent stderr] ${String(d).trimEnd()}`));

    const app = acp.client({ name: "masterportfolio" })
      .onRequest(acp.methods.client.session.requestPermission, ({ params }) => {
        this.deniedPermissions++;
        this.opts.log?.(`[permission denied] ${params.toolCall.title ?? params.toolCall.toolCallId}`);
        const reject = params.options.find((o) => o.kind === "reject_once") ?? params.options.find((o) => o.kind === "reject_always");
        return reject ? { outcome: { outcome: "selected", optionId: reject.optionId } } : { outcome: { outcome: "cancelled" } };
      })
      .onNotification(acp.methods.client.session.update, ({ params }) => {
        const u = params.update;
        if (u.sessionUpdate === "agent_message_chunk" && u.content.type === "text") this.active.get(params.sessionId)?.push(u.content.text);
        if (u.sessionUpdate === "tool_call") this.opts.log?.(`[tool_call] ${u.title}`);
        if (u.sessionUpdate === "usage_update") {
          const f = parseFiveHour(u._meta);
          if (f) this.fiveHour = f;
        }
      })
      .onRequest(acp.methods.client.fs.readTextFile, () => { throw new Error("fs not supported"); })
      .onRequest(acp.methods.client.fs.writeTextFile, () => { throw new Error("fs not supported"); });
    this.conn = app.connect(acp.ndJsonStream(Writable.toWeb(proc.stdin!) as WritableStream<Uint8Array>, Readable.toWeb(proc.stdout!) as ReadableStream<Uint8Array>));
    await this.handshake("initialize", this.conn.agent.request(acp.methods.agent.initialize, {
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    }));
  }

  async newSession(): Promise<string> {
    if (!this.conn || !this.workDir) throw new AgentError("crash", "에이전트가 시작되지 않음");
    const { sessionId } = await this.handshake("session/new", this.conn.agent.request(acp.methods.agent.session.new, {
      cwd: this.workDir, mcpServers: [], ...(this.cfg.sessionMeta ? { _meta: this.cfg.sessionMeta } : {}),
    }));
    if (this.cfg.initialModeId) {
      await this.conn.agent.request(acp.methods.agent.session.setMode, { sessionId, modeId: this.cfg.initialModeId })
        .catch((e: unknown) => this.opts.log?.(`[set_mode failed] ${describeError(e)}`));
    }
    return sessionId;
  }

  async prompt(sessionId: string, text: string, timeoutMs: number): Promise<AgentReply> {
    if (this.exited) return { ok: false, kind: "crash", detail: this.exited };
    const conn = this.conn;
    if (!conn) return { ok: false, kind: "crash", detail: "에이전트가 시작되지 않음" };
    if (this.broken.has(sessionId)) return { ok: false, kind: "crash", detail: "이전 턴이 취소 후에도 끝나지 않아 세션을 쓸 수 없음" };
    if (this.active.has(sessionId)) return { ok: false, kind: "other", detail: "같은 세션에서 이미 턴이 진행 중" };
    const buf: string[] = [];
    this.active.set(sessionId, buf);
    const run = conn.agent.request(acp.methods.agent.session.prompt, { sessionId, prompt: [{ type: "text", text }] })
      .then(
        (res): AgentReply => {
          this.opts.log?.(`[prompt] session=${sessionId} stopReason=${res.stopReason} chars=${buf.join("").length}`);
          const usage = parseTokenUsage(res);
          return usage ? { ok: true, text: buf.join(""), usage } : { ok: true, text: buf.join("") };
        },
        (e: unknown): AgentReply => { const err = this.fail(e); return { ok: false, kind: err.kind, detail: err.message }; })
      .finally(() => { if (this.active.get(sessionId) === buf) this.active.delete(sessionId); });
    const r = await within(run, timeoutMs);
    if (r !== TIMED_OUT) return r;

    this.opts.log?.(`[prompt] session=${sessionId} timeout after ${timeoutMs}ms → cancel`);
    await conn.agent.notify(acp.methods.agent.session.cancel, { sessionId }).catch(() => {});
    if ((await within(run, this.opts.cancelGraceMs ?? 10_000)) === TIMED_OUT) {
      this.broken.add(sessionId);
      if (this.active.get(sessionId) === buf) this.active.delete(sessionId);
      this.opts.log?.(`[prompt] session=${sessionId} did not settle after cancel → unusable`);
    }
    return { ok: false, kind: "timeout", detail: `${timeoutMs}ms 초과` };
  }

  async stop(): Promise<void> {
    const proc = this.proc, conn = this.conn;
    this.proc = null; this.conn = null;
    try { conn?.close(); } catch { /* already closed */ }
    if (proc && proc.exitCode === null && proc.signalCode === null) {
      const exit = new Promise<void>((res) => proc.once("exit", () => res()));
      proc.stdin?.end();
      const grace = this.opts.stopGraceMs ?? 3_000;
      if ((await within(exit, grace)) === TIMED_OUT) {
        if (process.platform === "win32" && proc.pid !== undefined) {
          spawnSync("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { windowsHide: true });
        } else {
          proc.kill("SIGTERM");
          if ((await within(exit, 1_000)) === TIMED_OUT) proc.kill("SIGKILL");
        }
        await within(exit, grace);
      }
    }
    await this.removeWorkDir();
  }

  private async removeWorkDir(): Promise<void> {
    const dir = this.workDir;
    this.workDir = null;
    if (!dir) return;
    await rm(dir, { recursive: true, force: true, maxRetries: 3 })
      .catch((e: unknown) => this.opts.log?.(`[workdir cleanup failed] ${dir}: ${describeError(e)}`));
  }
}
