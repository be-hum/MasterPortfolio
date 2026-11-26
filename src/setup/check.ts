import { access, constants, readdir } from "node:fs/promises";
import { exec, execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { foreignConfigMessage } from "../core/paths.js";
import { loadConfig } from "../config/config.js";
import { AcpBridge } from "../agent/bridge.js";
import { agentForStage } from "../agent/agents.js";

const run = promisify(execFile);
const runShell = promisify(exec);

export type AgentProbe = { ok: true } | { ok: false; kind: string; label: string; fix: string };

/**
 * 에이전트 연결 확인: 분석 단계와 같은 설정(빠른 모델)으로 띄워 한 단어 답을 받는다(아주 적은 사용량).
 * 로그인이 풀렸으면 kind="auth".
 */
export async function probeAgent(config: Awaited<ReturnType<typeof loadConfig>>): Promise<AgentProbe> {
  const cfg = config.agents[config.agent] ? agentForStage(config, "triage") : null;
  if (!cfg) return { ok: false, kind: "config", label: `에이전트 설정 없음: ${config.agent}`, fix: "`mp init`을 다시 실행하세요" };
  const b = new AcpBridge(cfg);
  try {
    await b.start(); const s = await b.newSession();
    const r = await b.prompt(s, "연결 확인입니다. 'OK' 한 단어로만 답하세요. 도구는 사용하지 마세요.", 120_000);
    if (r.ok) return { ok: true };
    return { ok: false, kind: r.kind, label: `에이전트 응답 오류 (${r.kind}): ${r.detail}`,
      fix: r.kind === "auth" ? `${config.agent} CLI를 직접 실행해 로그인하세요` : "에이전트 CLI와 ACP 어댑터 설치를 확인하세요" };
  } catch (e) {
    const kind = e instanceof Error && "kind" in e ? String((e as { kind: unknown }).kind) : "crash";
    return { ok: false, kind, label: `에이전트 실행 실패: ${e instanceof Error ? e.message : String(e)}`,
      fix: `${cfg.command} ${cfg.args.join(" ")} 명령이 동작하는지 확인하세요 (Claude Code 설치·로그인 필요)` };
  } finally { await b.stop(); }
}

/**
 * 오래 도는 백그라운드 서버는 시작할 때의 PATH를 그대로 가진다. 화면을 띄운 뒤 Claude Code를 설치하면
 * (Windows는 레지스트리 PATH에만 추가됨) 서버가 claude를 못 찾으므로, 흔한 설치 위치를 PATH에 더한다.
 * 이미 있으면 그대로. 이 프로세스와 이후 띄우는 작업에 함께 적용된다.
 */
export function ensureClaudeOnPath(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): void {
  const home = homedir();
  const dirs = platform === "win32"
    ? [join(home, ".local", "bin"), env.APPDATA ? join(env.APPDATA, "npm") : null, env.LOCALAPPDATA ? join(env.LOCALAPPDATA, "Programs", "claude") : null]
    : [join(home, ".local", "bin"), join(home, ".claude", "local"), "/opt/homebrew/bin", "/usr/local/bin"];
  const key = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  const sepC = platform === "win32" ? ";" : ":";
  const cur = (env[key] ?? "").split(sepC).filter(Boolean);
  const norm = (p: string) => (platform === "win32" ? p.toLowerCase().replace(/[\\/]+$/, "") : p.replace(/\/+$/, ""));
  const have = new Set(cur.map(norm));
  const add = dirs.filter((d): d is string => !!d && existsSync(d) && !have.has(norm(d)));
  if (add.length) env[key] = [...cur, ...add].join(sepC);
}

/** Claude Code CLI가 설치돼 있으면 버전 문자열, 없으면 null(처음 화면 11.7) */
export async function claudeVersion(): Promise<string | null> {
  ensureClaudeOnPath();
  try {
    // Windows의 npm 설치본은 claude.cmd라 셸을 거친다(고정 문자열 한 줄로 넘김)
    const { stdout } = process.platform === "win32"
      ? await runShell("claude --version", { windowsHide: true, timeout: 15_000 })
      : await run("claude", ["--version"], { windowsHide: true, timeout: 15_000 });
    const v = String(stdout).trim().split(/\r?\n/)[0];
    return v || null;
  } catch { return null; }
}

export type CheckItem = { ok: boolean; label: string; fix?: string; warn?: boolean };

/** 환경 점검 결과를 항목 목록으로 돌려준다(mp doctor와 화면 설정이 함께 쓴다). 문구는 doctor 출력과 같다 */
export async function checkEnvironment(out: string | null, opts: { skipAgent?: boolean }): Promise<CheckItem[]> {
  const items: CheckItem[] = [];
  const ok = (label: string) => items.push({ ok: true, label });
  const bad = (label: string, fix: string) => items.push({ ok: false, label, fix });

  const major = Number(process.versions.node.split(".")[0]);
  if (major >= 22) ok(`Node ${process.versions.node}`);
  else bad(`Node ${process.versions.node}`, "Node.js 22 이상을 설치하세요: https://nodejs.org");
  try { await run("git", ["--version"], { windowsHide: true }); ok("git"); }
  catch { items.push({ ok: false, warn: true, label: "git 없음 — git 저장소 분석(다음 버전)에 필요합니다." }); }

  if (!out) { bad("설정 없음", "`mp init`을 실행하세요"); return items; }
  let config;
  try { config = await loadConfig(out); }
  catch { bad(`설정 파일을 읽을 수 없음: ${out}`, "`mp init`을 다시 실행하세요"); return items; }
  try { await access(out, constants.W_OK); ok(`결과 폴더 쓰기 가능: ${out}`); }
  catch { bad(`결과 폴더 쓰기 불가: ${out}`, "권한을 확인하거나 `mp init`으로 다른 폴더를 지정하세요"); }

  const foreign = foreignConfigMessage(config.scanFolders);
  if (foreign) items.push({ ok: false, warn: true, label: foreign });
  for (const f of foreign ? [] : config.scanFolders) {
    try { await readdir(f); ok(`읽기 가능: ${f}`); }
    catch (e) {
      const fix = process.platform === "darwin" && (e as NodeJS.ErrnoException)?.code === "EPERM"
        ? "시스템 설정 → 개인정보 보호 및 보안 → 전체 디스크 접근 권한(또는 파일 및 폴더)에서 사용 중인 터미널 앱을 허용하세요"
        : "폴더가 존재하는지, 권한이 있는지 확인하세요";
      bad(`읽기 불가: ${f}`, fix);
    }
  }

  if (!opts.skipAgent) {
    const r = await probeAgent(config);
    if (r.ok) ok(`에이전트 연결: ${config.agent}`);
    else bad(r.label, r.fix);
  }
  return items;
}
