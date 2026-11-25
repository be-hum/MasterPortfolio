import { checkbox, confirm, input, select } from "@inquirer/prompts";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { defaultConfig, saveConfig } from "../config/config.js";
import { writeOutputPointer } from "../core/paths.js";
import { expandUniversity } from "../discovery/universities.js";
import { defaultFolders } from "../discovery/defaults.js";
import { findCandidateFolders } from "../discovery/candidates.js";
import { V1_AGENTS, withLocalExecutable } from "../agent/agents.js";
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

/** 사용자가 입력한 폴더 경로: 앞뒤 공백·감싼 따옴표 제거, 맨 앞 `~` 펼치기, 절대경로로. 빈 입력은 null. */
export function normalizeFolderInput(raw: string, home: string = homedir()): string | null {
  let s = raw.trim();
  if (s.length >= 2 && /^(["']).*\1$/s.test(s)) s = s.slice(1, -1).trim();
  if (!s) return null;
  if (s === "~") s = home;
  else if (/^~[\\/]/.test(s)) s = join(home, s.slice(2));
  return resolve(s);
}

const normalizeFolders = (list: string[]) => list.map((f) => normalizeFolderInput(f)).filter((f): f is string => f !== null);

/** 결과 폴더가 스캔 폴더 안에 있으면 알린다(스캔은 결과 폴더를 자동으로 건너뛴다). */
function warnOutputInsideScan(output: string, folders: string[]): void {
  const parent = folders.find((f) => isUnderAny(output, [f]));
  if (parent) console.log(`! 결과 폴더(${output})가 스캔 폴더(${parent}) 안에 있습니다. 스캔할 때 결과 폴더는 자동으로 제외됩니다.`);
}

export async function runInit(opts: InitOptions): Promise<number> {
  const output = normalizeFolderInput(opts.output ?? process.env.MP_OUTPUT_DIR ?? "") ?? join(homedir(), "MasterPortfolio");
  if (opts.nonInteractive) {
    const agentName = opts.agent ?? "claude";
    const allowed = (V1_AGENTS as readonly string[]).includes(agentName) || process.env.MP_ALLOW_TEST_AGENTS === "1";
    if (!allowed) { console.error(`지원하지 않는 에이전트: ${agentName} (가능: ${V1_AGENTS.join(", ")})`); return 2; }
    const keywords = opts.university ? expandUniversity(opts.university) : [];
    const scanFolders = normalizeFolders(opts.folders ?? []);
    warnOutputInsideScan(output, scanFolders);
    const c = defaultConfig({ university: { input: opts.university ?? "", keywords }, scanFolders, agent: agentName });
    if (opts.planScale) c.budget.planScale = opts.planScale;
    if (c.agents[c.agent]) c.agents[c.agent] = await withLocalExecutable(c.agent, c.agents[c.agent]);
    await saveConfig(output, c); await writeOutputPointer(output);
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
  const defaults = await defaultFolders();
  const candidates = await findCandidateFolders(homedir(), ["project", "projects", "프로젝트", ...keywords], 4);
  const under = (p: string, d: string) => p === d || p.startsWith(d + sep);
  const choices = [
    ...defaults.map((p) => ({ name: p, value: p, checked: true })),
    ...candidates.filter((p) => !defaults.some((d) => under(p, d))).map((p) => ({ name: p, value: p, checked: false })),
  ];
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
  const c = defaultConfig({ university: { input: uniInput, keywords }, scanFolders, agent });
  c.budget.planScale = planScale;
  c.agents[agent] = await withLocalExecutable(agent, c.agents[agent]);
  if (!c.agents[agent].env?.CLAUDE_CODE_EXECUTABLE && !c.agents[agent].env?.CODEX_PATH) {
    console.log(`! 설치된 ${agent} CLI를 찾지 못했습니다. 어댑터에 포함된 CLI를 사용합니다. 공식 CLI를 설치·로그인한 뒤 \`mp init\`을 다시 실행하는 것을 권장합니다.`);
  }
  await saveConfig(outDir, c); await writeOutputPointer(outDir);
  console.log(`설정을 저장했습니다: ${join(outDir, ".mp", "config.json")}`);
  if (await confirm({ message: "지금 환경 점검(mp doctor)을 실행할까요?", default: true })) {
    const d = await runDoctor({});
    if (d !== 0) { console.log("환경 점검을 통과하지 못해 폴더 범위 정리를 건너뜁니다. 문제를 해결한 뒤 `mp scope`를 실행하세요."); return d; }
  }
  if (opts.scope === false || !scanFolders.length) return 0;
  if (!(await confirm({ message: "지금 폴더 범위를 정리할까요(mp scope, 폴더 경로·파일 이름 예시만 전송)?", default: true }))) return 0;
  return initScope(opts, c, outDir, false);
}
