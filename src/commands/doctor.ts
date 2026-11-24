import { access, constants, readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { foreignConfigMessage, resolveOutputDir } from "../core/paths.js";
import { loadConfig } from "../config/config.js";
import { AcpBridge } from "../agent/bridge.js";
import { agentForStage } from "../agent/agents.js";

const run = promisify(execFile);

export async function runDoctor(opts: { skipAgent?: boolean }): Promise<number> {
  let fail = 0;
  const ok = (m: string) => console.log(`✔ ${m}`);
  const bad = (m: string, fix: string) => { fail++; console.log(`✘ ${m}\n   → ${fix}`); };

  const major = Number(process.versions.node.split(".")[0]);
  if (major >= 22) ok(`Node ${process.versions.node}`);
  else bad(`Node ${process.versions.node}`, "Node.js 22 이상을 설치하세요: https://nodejs.org");
  try { await run("git", ["--version"], { windowsHide: true }); ok("git"); }
  catch { console.log("! git 없음 — git 저장소 분석(다음 버전)에 필요합니다."); }

  const out = await resolveOutputDir();
  if (!out) { bad("설정 없음", "`mp init`을 실행하세요"); return 1; }
  let config;
  try { config = await loadConfig(out); }
  catch { bad(`설정 파일을 읽을 수 없음: ${out}`, "`mp init`을 다시 실행하세요"); return 1; }
  try { await access(out, constants.W_OK); ok(`결과 폴더 쓰기 가능: ${out}`); }
  catch { bad(`결과 폴더 쓰기 불가: ${out}`, "권한을 확인하거나 `mp init`으로 다른 폴더를 지정하세요"); }

  const foreign = foreignConfigMessage(config.scanFolders);
  if (foreign) console.log(`ℹ ${foreign.replace("\n", "\n  ")}`);
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
    // 분석 단계와 같은 실행 설정(빠른 모델·이 PC에 없는 CLI 경로 제외)으로 점검한다
    const cfg = config.agents[config.agent] ? agentForStage(config, "triage") : null;
    if (!cfg) bad(`에이전트 설정 없음: ${config.agent}`, "`mp init`을 다시 실행하세요");
    else {
      const b = new AcpBridge(cfg);
      try {
        await b.start(); const s = await b.newSession();
        const r = await b.prompt(s, "연결 확인입니다. 'OK' 한 단어로만 답하세요. 도구는 사용하지 마세요.", 120_000);
        if (r.ok) ok(`에이전트 연결: ${config.agent}`);
        else bad(`에이전트 응답 오류 (${r.kind}): ${r.detail}`,
          r.kind === "auth" ? `${config.agent} CLI를 직접 실행해 로그인하세요` : "에이전트 CLI와 ACP 어댑터 설치를 확인하세요");
      } catch (e) {
        bad(`에이전트 실행 실패: ${e instanceof Error ? e.message : String(e)}`,
          `${cfg.command} ${cfg.args.join(" ")} 명령이 동작하는지 확인하세요 (Claude Code 설치·로그인 필요)`);
      } finally { await b.stop(); }
    }
  }
  console.log(fail ? `\n문제 ${fail}개` : "\n모든 점검 통과");
  return fail ? 1 : 0;
}
