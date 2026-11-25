import { access, constants, readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { foreignConfigMessage } from "../core/paths.js";
import { loadConfig } from "../config/config.js";
import { AcpBridge } from "../agent/bridge.js";
import { agentForStage } from "../agent/agents.js";

const run = promisify(execFile);

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
