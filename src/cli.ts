#!/usr/bin/env node
import { Command, CommanderError, InvalidArgumentError } from "commander";
import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";
import { runInit } from "./commands/init.js";
import { runDoctor } from "./commands/doctor.js";
import { runScan } from "./commands/scan.js";
import { runScopeCommand } from "./commands/scope.js";
import { runGroup } from "./commands/group.js";
import { runReview } from "./commands/review.js";
import { runKeywords } from "./commands/keywords.js";
import { refreshMaster, runMaster } from "./commands/master.js";
import { VERSION } from "./version.js";
import { runServe, runUi } from "./commands/ui.js";
import { runStart } from "./commands/start.js";

function parseLimit(v: string): number {
  const n = Number(v);
  if (!/^\d+$/.test(v.trim()) || !Number.isSafeInteger(n) || n <= 0) throw new InvalidArgumentError("1 이상의 정수를 입력하세요.");
  return n;
}

function parseBudget(v: string): number {
  const n = Number(v);
  if (!/^\s*\d*\.?\d+\s*$/.test(v) || !(n > 0 && n <= 1)) throw new InvalidArgumentError("0보다 크고 1 이하인 수를 입력하세요(예: 0.3).");
  return n;
}

export function buildProgram(): Command {
  const program = new Command();
  program.name("mp").description("MasterPortfolio: 이력서·포트폴리오 자료 인벤토리").version(VERSION);
  program.exitOverride();
  program.command("init").description("대학명·스캔 폴더·에이전트 설정")
    .option("--non-interactive").option("--university <name>").option("--folders <paths...>").option("--agent <name>").option("--output <dir>")
    .option("--plan-scale <n>", "Claude 요금제 배수: Pro 1, Max 5x 5, Max 20x 20", parseLimit)
    .option("--no-scope", "끝에서 폴더 범위 정리(mp scope)를 하지 않음")
    .action(async (o) => { process.exitCode = await runInit(o); });
  program.command("doctor").description("환경 점검").option("--skip-agent")
    .action(async (o) => { process.exitCode = await runDoctor(o); });
  program.command("scan").description("새 파일을 분석해 카드 생성")
    .option("--limit <n>", "이번에 처리할 최대 파일 수", parseLimit).option("--yes", "확인 생략").option("--log-prompts", "전송 프롬프트 저장")
    .option("--no-triage", "0단계 선별(무관한 파일 거르기)을 건너뜀")
    .option("--retriage", "선별에서 제외된 파일(skipped_irrelevant)을 다시 후보로 넣음")
    .option("--budget <share>", "이번 실행이 쓸 5시간 사용량 창 비율(0~1, 기본 config의 0.3)", parseBudget)
    .action(async (o) => {
      process.exitCode = (await runScan({ limit: o.limit, yes: o.yes, logPrompts: o.logPrompts, triage: o.triage, retriage: o.retriage, budget: o.budget })).code;
    });
  program.command("scope").description("폴더 범위 정리: LLM 판단 + 애매한 폴더 질의")
    .option("--list", "저장된 판단 목록").option("--reset <path>", "그 경로와 하위 폴더의 판단 삭제")
    .option("--yes", "질의 생략(애매한 폴더는 이번엔 포함, 저장 안 함)").option("--log-prompts", "전송 프롬프트 저장")
    .option("--budget <share>", "이번 실행이 쓸 5시간 사용량 창 비율(0~1)", parseBudget)
    .action(async (o) => {
      process.exitCode = await runScopeCommand({ list: o.list, reset: o.reset, yes: o.yes, logPrompts: o.logPrompts, budget: o.budget });
    });
  program.command("group").description("상·중 파일 카드를 경험 카드로 묶고 보강 질문 생성")
    .option("--regroup", "경험 아님으로 남긴 카드도 다시 보냄").option("--yes", "확인 생략").option("--log-prompts", "전송 프롬프트 저장")
    .option("--budget <share>", "이번 실행이 쓸 5시간 사용량 창 비율(0~1)", parseBudget)
    .action(async (o) => { process.exitCode = (await runGroup({ regroup: o.regroup, yes: o.yes, logPrompts: o.logPrompts, budget: o.budget })).code; await refreshMaster(); });
  program.command("review").description("경험별 질의응답 → 답변을 카드에 반영")
    .option("--file", "질문을 review.md로 쓰기").option("--apply", "채운 review.md 반영").option("--all", "가치 '하' 경험도 포함")
    .option("--apply-only", "질의응답 없이 반영 대기 경험만 반영")
    .option("--accept-edits", "바깥에서 편집된 경험 카드를 현재 내용대로 받아들임")
    .option("--yes", "확인 생략").option("--log-prompts", "전송 프롬프트 저장")
    .option("--budget <share>", "이번 실행이 쓸 5시간 사용량 창 비율(0~1)", parseBudget)
    .action(async (o) => { process.exitCode = (await runReview({ file: o.file, apply: o.apply, all: o.all, acceptEdits: o.acceptEdits, applyOnly: o.applyOnly, yes: o.yes, logPrompts: o.logPrompts, budget: o.budget })).code; await refreshMaster(); });
  program.command("keywords").description("경험·성과 키워드 만들기(빠른 모델)")
    .option("--all", "이미 있는 것도 다시").option("--yes", "확인 생략").option("--log-prompts", "전송 프롬프트 저장")
    .option("--budget <share>", "이번 실행이 쓸 5시간 사용량 창 비율(0~1)", parseBudget)
    .action(async (o) => { process.exitCode = (await runKeywords({ all: o.all, yes: o.yes, logPrompts: o.logPrompts, budget: o.budget })).code; await refreshMaster(); });
  program.command("master").description("채택된 경험 카드로 master.md 생성(LLM 없음)")
    .action(async () => { process.exitCode = (await runMaster()).code; });
  program.command("ui").description("브라우저에서 결과 보기·결정·답변·반영")
    .option("--port <n>", "포트(기본: 임의)", parseLimit).option("--no-open", "브라우저를 열지 않음")
    .action(async (o) => { process.exitCode = (await runUi({ port: o.port, open: o.open })).code; });
  program.command("start").description("화면 서버를 뒤에서 띄우고(이미 실행 중이면 그대로) 브라우저로 열기(더블클릭 실행용)")
    .action(async () => { process.exitCode = await runStart(); });
  // 내부용: 실행기(start)가 분리 프로세스로 띄우는 화면 서버(고정 포트 4317~4327, 고정 토큰)
  program.command("serve", { hidden: true }).description("화면 서버(백그라운드용)")
    .action(async () => { process.exitCode = await runServe(); });
  return program;
}

export async function main(argv: string[]): Promise<number> {
  const program = buildProgram();
  try {
    await program.parseAsync(argv);
    return typeof process.exitCode === "number" ? process.exitCode : 0;
  } catch (e) {
    if (e instanceof CommanderError) return e.exitCode;
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }
}

const invokedPath = (() => { try { return realpathSync(process.argv[1] ?? ""); } catch { return ""; } })();
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main(process.argv).then((code) => process.exit(code));
}
