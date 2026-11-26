import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * 로컬 웹 앱 실행 구조(11.7): 뒤에서 도는 서버(`mp serve`)와 그것을 띄우거나 다시 여는 실행기(`mp start`).
 * 상태 파일은 사용자 홈의 `.masterportfolio/`(테스트는 MP_HOME_DIR).
 */
export const BASE_PORT = 4317;
export const PORT_RANGE = Array.from({ length: 11 }, (_, i) => BASE_PORT + i);
export const APP_ID = "MasterPortfolio";

export const mpHome = () => process.env.MP_HOME_DIR ?? join(homedir(), ".masterportfolio");
const ensureHome = () => { mkdirSync(mpHome(), { recursive: true }); return mpHome(); };

/**
 * 한 번 만든 토큰을 계속 쓴다(즐겨찾기한 주소가 쿠키로 열리도록). 파일 권한 0600.
 * 같은 사용자 권한의 다른 프로그램은 이 파일을 읽을 수 있다: 보호 대상은 다른 웹페이지(브라우저)이지 내 PC의 프로그램이 아니다.
 */
export function loadOrCreateToken(): string {
  const p = join(ensureHome(), "token");
  try {
    const t = readFileSync(p, "utf8").trim();
    if (/^[0-9a-f]{64}$/.test(t)) return t;
  } catch { /* 없음 */ }
  const t = randomBytes(32).toString("hex");
  writeFileSync(p, t, { mode: 0o600 });
  try { chmodSync(p, 0o600); } catch { /* Windows는 무시 */ }
  return t;
}

/** ping으로 공개해도 되는 토큰 식별값(같은 PC의 같은 설치인지 확인용) */
export const tokenId = (token: string) => createHash("sha256").update(token).digest("hex").slice(0, 12);

export type ServerInfo = { port: number; pid: number; version: string };
const infoPath = () => join(mpHome(), "server.json");

export function readServerInfo(): ServerInfo | null {
  try {
    const j = JSON.parse(readFileSync(infoPath(), "utf8"));
    return Number.isInteger(j.port) && Number.isInteger(j.pid) && typeof j.version === "string" ? j : null;
  } catch { return null; }
}
export function writeServerInfo(i: ServerInfo): void { writeFileSync(join(ensureHome(), "server.json"), JSON.stringify(i)); }
/** 내가 쓴 기록일 때만 지운다(새 서버가 이미 덮어썼으면 그대로) */
export function removeServerInfo(pid: number): void {
  if (readServerInfo()?.pid === pid) rmSync(infoPath(), { force: true });
}

export type Ping = { app: string; version: string; id: string; busy: boolean };

/** 그 포트의 서버가 MasterPortfolio인지 묻는다. 응답이 없거나 다른 프로그램이면 null */
export async function ping(port: number, timeoutMs = 1500): Promise<Ping | null> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/ping`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return null;
    const j = await r.json() as Partial<Ping>;
    return j.app === APP_ID && typeof j.version === "string" && typeof j.id === "string" ? { app: j.app, version: j.version, id: j.id, busy: !!j.busy } : null;
  } catch { return null; }
}

/** 서버 로그 파일을 덧붙여 연다(5MB가 넘으면 새로 시작). 파일 디스크립터 */
export function openServerLog(): { fd: number; path: string } {
  const dir = join(ensureHome(), "logs");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "server.log");
  let big = false;
  try { big = statSync(path).size > 5 * 1024 * 1024; } catch { /* 없음 */ }
  return { fd: openSync(path, big ? "w" : "a"), path };
}

export type LaunchDeps = {
  version: string;
  token: string;
  /** `mp serve`를 분리 프로세스로 띄운다 */
  spawnServer: () => void;
  openBrowser: (url: string) => boolean;
  ping?: typeof ping;
  readInfo?: () => ServerInfo | null;
  shutdown?: (port: number) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  waitMs?: number;
  log?: (line: string) => void;
};

/**
 * `mp start`: 이미 도는 같은 설치·같은 버전 서버가 있으면 브라우저만 연다.
 * 버전이 다르면(업데이트 직후) 작업 중이 아닐 때 끄고 새로 띄운다. 없으면 띄우고 응답할 때까지 기다린다.
 */
export async function launch(d: LaunchDeps): Promise<{ code: number; url: string | null }> {
  const pingFn = d.ping ?? ping;
  const readInfo = d.readInfo ?? readServerInfo;
  const sleep = d.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const log = d.log ?? ((l: string) => console.log(l));
  const id = tokenId(d.token);
  const urlFor = (port: number) => `http://localhost:${port}/?t=${d.token}`;
  const ours = async (): Promise<{ port: number; p: Ping } | null> => {
    const info = readInfo();
    if (!info) return null;
    const p = await pingFn(info.port);
    return p && p.id === id ? { port: info.port, p } : null;
  };

  const running = await ours();
  if (running) {
    if (running.p.version === d.version || running.p.busy) {
      if (running.p.version !== d.version) log(`이전 버전(${running.p.version}) 화면에서 작업이 실행 중이라 그대로 엽니다. 작업이 끝난 뒤 다시 실행하면 새 버전으로 바뀝니다.`);
      const url = urlFor(running.port);
      if (!d.openBrowser(url)) log(`브라우저를 열지 못했습니다. 이 주소를 직접 여세요: http://localhost:${running.port}`);
      return { code: 0, url };
    }
    log(`이전 버전(${running.p.version})을 끄고 ${d.version}으로 다시 시작합니다.`);
    await (d.shutdown ?? defaultShutdown(d.token))(running.port);
    for (let i = 0; i < 20 && (await pingFn(running.port)); i++) await sleep(250);
  }

  d.spawnServer();
  const until = Date.now() + (d.waitMs ?? 20_000);
  while (Date.now() < until) {
    await sleep(250);
    const up = await ours();
    if (up && up.p.version === d.version) {
      const url = urlFor(up.port);
      if (!d.openBrowser(url)) log(`브라우저를 열지 못했습니다. 이 주소를 직접 여세요: http://localhost:${up.port}`);
      return { code: 0, url };
    }
  }
  log(`화면 서버를 시작하지 못했습니다. 기록을 확인하세요: ${join(mpHome(), "logs", "server.log")}`);
  return { code: 1, url: null };
}

const defaultShutdown = (token: string) => async (port: number) => {
  try { await fetch(`http://127.0.0.1:${port}/api/shutdown`, { method: "POST", headers: { "x-mp-token": token, "content-type": "application/json" }, body: "{}", signal: AbortSignal.timeout(3000) }); } catch { /* 이미 꺼짐 */ }
};

/** 실행기에서 서버를 띄운다: 콘솔과 분리(Windows 창 숨김, POSIX 새 세션), 출력은 로그 파일로 */
export function spawnServeProcess(cliPath: string, env: NodeJS.ProcessEnv = process.env): void {
  const { fd } = openServerLog();
  try {
    const c = spawn(process.execPath, [cliPath, "serve"], { detached: true, windowsHide: true, stdio: ["ignore", fd, fd], env });
    c.unref();
  } finally { closeSync(fd); }
}

export const hasServerInfo = () => existsSync(infoPath());
