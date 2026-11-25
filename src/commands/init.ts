import { checkbox, confirm, input, select } from "@inquirer/prompts";
import { join } from "node:path";
import { createSetupConfig, normalizeFolderInput, SetupError } from "../setup/config.js";
import { defaultOutputDir, suggestFolders } from "../setup/folders.js";
import { expandUniversity } from "../discovery/universities.js";
import { V1_AGENTS } from "../agent/agents.js";
import { isUnderAny } from "../discovery/walk.js";
import { runDoctor } from "./doctor.js";
import { runScopeCommand, type ScopeCommandOptions } from "./scope.js";
import type { Config } from "../core/schema.js";

export type InitOptions = {
  nonInteractive?: boolean; university?: string; folders?: string[]; agent?: string; output?: string;
  /** 요금제 배수(9.8 planScale): Pro 1, Max 5x 5, Max 20x 20 */
  planScale?: number;
  /** false면 끝에서 폴더 범위 정리(5.5)를 하지 않는다(`--no-scope`). 기본 true */
  scope?: boolean;
  /** 테스트용: 폴더 범위 단계 교체 */
  runScope?: (o: ScopeCommandOptions) => Promise<number>;
};

/**
 * init 끝의 폴더 범위 정리(5.5). 비대화형이면 --yes처럼(애매한 폴더는 이번엔 포함, 저장 안 함).
 * 스캔 폴더가 없거나 선택한 에이전트 설정이 없으면 건너뛴다.
 */
async function initScope(opts: InitOptions, c: Config, outDir: string, yes: boolean): Promise<number> {
  if (opts.scope === false || !c.scanFolders.length) return 0;
  if (!c.agents[c.agent]) { console.log(`에이전트 '${c.agent}' 설정이 없어 폴더 범위 정리를 건너뜁니다. 나중에 \`mp scope\`로 실행하세요.`); return 0; }
  console.log("폴더 범위를 정리합니다(mp scope). 폴더 경로와 파일 이름 예시만 에이전트로 보냅니다.");
  return (opts.runScope ?? runScopeCommand)({ yes, outputDir: outDir });
}

export { normalizeFolderInput };

const normalizeFolders = (list: string[]) => list.map((f) => normalizeFolderInput(f)).filter((f): f is string => f !== null);

/** 결과 폴더가 스캔 폴더 안에 있으면 알린다(스캔은 결과 폴더를 자동으로 건너뛴다). */
function warnOutputInsideScan(output: string, folders: string[]): void {
  const parent = folders.find((f) => isUnderAny(output, [f]));
  if (parent) console.log(`! 결과 폴더(${output})가 스캔 폴더(${parent}) 안에 있습니다. 스캔할 때 결과 폴더는 자동으로 제외됩니다.`);
}

/** 공유 설정 생성기로 저장한다. `mp init`은 아직 없는 폴더·빈 목록도 허용해 왔으므로 lenient */
async function create(i: Parameters<typeof createSetupConfig>[0]): Promise<Config | null> {
  try { return (await createSetupConfig(i, { lenient: true })).config; }
  catch (e) { if (e instanceof SetupError) { console.error(e.errors.join("\n")); return null; } throw e; }
}

export async function runInit(opts: InitOptions): Promise<number> {
  const output = normalizeFolderInput(opts.output ?? process.env.MP_OUTPUT_DIR ?? "") ?? await defaultOutputDir();
  if (opts.nonInteractive) {
    const agentName = opts.agent ?? "claude";
    const allowed = (V1_AGENTS as readonly string[]).includes(agentName) || process.env.MP_ALLOW_TEST_AGENTS === "1";
    if (!allowed) { console.error(`지원하지 않는 에이전트: ${agentName} (가능: ${V1_AGENTS.join(", ")})`); return 2; }
    const keywords = opts.university ? expandUniversity(opts.university) : [];
    const scanFolders = normalizeFolders(opts.folders ?? []);
    warnOutputInsideScan(output, scanFolders);
    const c = await create({ university: opts.university ?? "", keywords, folders: scanFolders, planScale: opts.planScale || 1, output, agent: agentName });
    if (!c) return 2;
    console.log(`설정을 저장했습니다: ${join(output, ".mp", "config.json")}`);
    return initScope(opts, c, output, true);
  }
  const uniInput = (await input({ message: "대학교 이름을 입력하세요 (예: 연세대, 연세대학교, KAIST). 없으면 Enter:" })).trim();
  let keywords: string[] = [];
  if (uniInput) {
    const expanded = expandUniversity(uniInput);
    keywords = expanded.length
      ? await checkbox({ message: "폴더 검색에 쓸 이름을 고르세요", choices: expanded.map((k) => ({ name: k, value: k, checked: true })) })
      : [];
    const extra = await input({ message: "추가할 이름이 있으면 쉼표로 입력하세요 (없으면 Enter):" });
    keywords.push(...extra.split(",").map((s) => s.trim()).filter(Boolean));
  }
  console.log("폴더를 찾는 중...");
  const choices = (await suggestFolders(keywords)).map((s) => ({ name: `${s.label} — ${s.path}`, value: s.path, checked: s.checked }));
  const folders = choices.length ? await checkbox({ message: "스캔할 폴더를 고르세요", choices }) : [];
  const extraFolder = await input({ message: "직접 추가할 폴더 경로 (쉼표 구분, 없으면 Enter):" });
  folders.push(...normalizeFolders(extraFolder.split(",")));
  const agent = await select({ message: "사용할 에이전트", choices: V1_AGENTS.map((k) => ({ name: k, value: k as string })) });
  // 사용량 예산(9.8)은 Pro 기준이라, 더 큰 요금제면 배수로 환산한다
  const planScale = agent === "claude"
    ? await select({ message: "Claude 구독 요금제 (사용량 예산 계산용)", choices: [
      { name: "Pro", value: 1 }, { name: "Max 5x", value: 5 }, { name: "Max 20x", value: 20 },
    ] })
    : 1;
  const outDir = normalizeFolderInput(await input({ message: "결과 폴더", default: output })) ?? output;
  const scanFolders = [...new Set(normalizeFolders(folders))];
  warnOutputInsideScan(outDir, scanFolders);
  const c = await create({ university: uniInput, keywords, folders: scanFolders, planScale, output: outDir, agent });
  if (!c) return 2;
  if (!c.agents[agent].env?.CLAUDE_CODE_EXECUTABLE && !c.agents[agent].env?.CODEX_PATH) {
    console.log(`! 설치된 ${agent} CLI를 찾지 못했습니다. 어댑터에 포함된 CLI를 사용합니다. 공식 CLI를 설치·로그인한 뒤 \`mp init\`을 다시 실행하는 것을 권장합니다.`);
  }
  console.log(`설정을 저장했습니다: ${join(outDir, ".mp", "config.json")}`);
  if (await confirm({ message: "지금 환경 점검(mp doctor)을 실행할까요?", default: true })) {
    const d = await runDoctor({});
    if (d !== 0) { console.log("환경 점검을 통과하지 못해 폴더 범위 정리를 건너뜁니다. 문제를 해결한 뒤 `mp scope`를 실행하세요."); return d; }
  }
  if (opts.scope === false || !scanFolders.length) return 0;
  if (!(await confirm({ message: "지금 폴더 범위를 정리할까요(mp scope, 폴더 경로·파일 이름 예시만 전송)?", default: true }))) return 0;
  return initScope(opts, c, outDir, false);
}
