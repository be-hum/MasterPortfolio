import { appendFileSync } from "node:fs";
import { progress } from "../core/progress.js";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { confirm as inqConfirm, expand } from "@inquirer/prompts";
import { loadConfig, saveConfig } from "../config/config.js";
import { foreignConfigMessage, resolveOutputDir } from "../core/paths.js";
import type { Config } from "../core/schema.js";
import type { Stop } from "../analyzer/analyze.js";
import { scopeFolders, type ScopeItem, type ScopeResult } from "../analyzer/scope.js";
import { createStageRunner, type StageRunner } from "../agent/runner.js";
import { walk } from "../discovery/walk.js";
import { resetScopeDecisions, setScopeDecision } from "../discovery/scopeDecisions.js";
import { collectScopeFolders, contentNameCheck, type ScopeFolder } from "../scan/scopeCandidates.js";
import { extractorFor } from "../extractors/registry.js";
import { isoNow } from "../store/cards.js";
import { normalizeFolderInput } from "./init.js";

/** 질의 답(5.5): y 포함 / n 제외 / s 나중에(이번엔 포함, 저장 안 함) */
export type ScopeAnswer = "y" | "n" | "s";
export type ScopeAsk = (folder: ScopeFolder, question: string) => Promise<ScopeAnswer>;
export type ScopeDecided = { path: string; decision: "include" | "exclude"; by: "llm" | "user" };
/** 이번 실행의 범위 단계 결과. later: 나중에(s)·판단 없음(응답 누락·파싱 실패·중단으로 남은 폴더) */
export type ScopeSummary = { included: number; excluded: number; later: number; decided: ScopeDecided[] };

export const DEFAULT_SCOPE_QUESTION = "이 폴더에 직접 만든 과제·보고서·프로젝트 자료가 있나요?";

const describeExts = (f: ScopeFolder) => Object.entries(f.extCounts).sort((a, b) => b[1] - a[1]).map(([e, n]) => `${e} ${n}`).join(", ");

/** 터미널 질의(5.5): 경로·파일 수·예시·질문을 보여 주고 y/n/s */
export const terminalScopeAsk: ScopeAsk = async (f, q) => {
  console.log(`\n폴더: ${f.path}\n파일 ${f.fileCount}개 (${describeExts(f)})${f.samples.length ? `\n예시: ${f.samples.join(", ")}` : ""}`);
  return expand<ScopeAnswer>({
    message: q, default: "s", expanded: true,
    choices: [
      { key: "y", name: "포함", value: "y" },
      { key: "n", name: "제외 (하위 폴더 포함)", value: "n" },
      { key: "s", name: "나중에 (이번엔 포함, 저장 안 함)", value: "s" },
    ],
  });
};

/**
 * 폴더 범위 단계(5.5). LLM 판단(include/exclude)은 by: llm으로 저장하고, ask는 질의한다(ask가 null이면 모두 s).
 * - crash: 에이전트 1회 재시작 후 판단 없는 폴더만 다시 보낸다.
 * - no_results(회로 차단): 남은 폴더는 이번엔 포함으로 두고 진행(stopped 없음).
 * - rate_limit·auth·budget(또는 재시작 후 다시 crash): 남은 폴더는 판단 없음으로 두고 stopped를 돌려준다(호출 측이 멈춤).
 * 판단은 중단 여부와 관계없이 config에 저장한다(save).
 */
export async function runScopeStage(config: Config, folders: ScopeFolder[], deps: {
  runner: StageRunner; log: (line: string) => void; ask: ScopeAsk | null; save: () => Promise<void>;
  now?: () => string; platform?: NodeJS.Platform;
}): Promise<{ stopped: Stop | null; summary: ScopeSummary }> {
  const { runner, log } = deps;
  const now = deps.now ?? isoNow;
  const summary: ScopeSummary = { included: 0, excluded: 0, later: 0, decided: [] };
  if (!folders.length) return { stopped: null, summary };
  const byId = new Map<string, ScopeFolder>();
  const items: ScopeItem[] = folders.map((f, i) => {
    const id = `d${i + 1}`;
    byId.set(id, f);
    return { id, relPath: f.relPath, extCounts: f.extCounts, samples: f.samples };
  });
  for (const it of items) log(`[scope folder] ${it.id}=${byId.get(it.id)!.key}`);
  const results = new Map<string, ScopeResult>();
  const decide = (f: ScopeFolder, decision: "include" | "exclude", by: "llm" | "user") => {
    // 대상 선정에서 판단 있는 폴더는 빠지므로 보통 생기지 않지만, 사용자 판단은 LLM이 덮어쓰지 않는다
    if (!setScopeDecision(config.scope.decisions, f.path, decision, by, now(), deps.platform)) { log(`[scope kept user decision] ${f.key}`); return; }
    summary.decided.push({ path: f.key, decision, by });
    log(`[scope ${decision}] ${by} ${f.key}`);
  };
  runner.ranStages.add("scope");
  const run = (its: ScopeItem[]) => runner.withBridge("scope", (bridge) => scopeFolders(bridge, its, {
    timeoutMs: config.limits.batchTimeoutMs, ...runner.budgetHooks("scope", bridge),
    onPrompt: runner.onPromptFor("scope"), onBatch: runner.onBatchFor("scope"),
    onUnparsed: (t) => log(`[unparsed scope reply] ${JSON.stringify(t.slice(0, 300))}`),
    onResult: async (id, r) => { results.set(id, r); },
  }));
  let res = await run(items);
  if (res.stopped?.kind === "crash") {
    log(`[restart scope] ${res.stopped.detail}`);
    const remaining = items.filter((i) => !results.has(i.id));
    if (remaining.length) res = await run(remaining);
  }
  if (res.stopped?.kind === "no_results") {
    log(`[scope undecided] ${res.stopped.detail}`);
    res = { stopped: null };
  }
  const asks: [ScopeFolder, string][] = [];
  for (const [id, r] of results) {
    const f = byId.get(id)!;
    if (r.decision === "ask") asks.push([f, r.q ?? DEFAULT_SCOPE_QUESTION]);
    else decide(f, r.decision, "llm");
  }
  // 멈췄으면 묻지 않는다(ask 폴더도 판단 없음으로 남아 다음에 다시 판단)
  if (!res.stopped) {
    for (const [f, q] of asks) {
      const a = deps.ask ? await deps.ask(f, q) : "s";
      if (a === "y") decide(f, "include", "user");
      else if (a === "n") decide(f, "exclude", "user");
      // 질문도 남겨 --yes 실행 뒤 사용자가 로그에서 확인할 수 있게 한다
      else log(`[scope later] ${f.key} — ${q}`);
    }
  }
  summary.included = summary.decided.filter((d) => d.decision === "include").length;
  summary.excluded = summary.decided.filter((d) => d.decision === "exclude").length;
  summary.later = folders.length - summary.included - summary.excluded;
  if (res.stopped) log(`[scope stopped] ${res.stopped.kind}: ${res.stopped.detail}`);
  await deps.save();
  return { stopped: res.stopped, summary };
}

/** 범위 단계 중단 안내 */
export function scopeStopReason(stop: Stop, runner: StageRunner, agent: string, left: number): string {
  return stop.kind === "budget" ? runner.budgetReason(stop, `판단 없는 폴더 ${left}개`)
    : stop.kind === "rate_limit" ? `사용량 한도(범위 단계) — 판단 없는 폴더 ${left}개가 남았습니다. 나중에 다시 실행하세요.`
    : stop.kind === "auth" ? `로그인 필요 — ${agent} CLI에서 로그인한 뒤 다시 실행하세요.`
    : `에이전트 오류(범위 단계) — ${stop.detail}`;
}

/** 모든 스캔 폴더를 현재 판단으로 순회한다(결과 폴더 제외). */
export async function walkScanFolders(config: Config, out: string, log?: (line: string) => void) {
  const excludeRoots = [resolve(out)];
  const walks: { root: string; result: Awaited<ReturnType<typeof walk>> }[] = [];
  let found = 0;
  const onFile = () => { if (++found % 200 === 0) progress.local("walk", found, 0); };
  for (const root of config.scanFolders) {
    const t = Date.now();
    walks.push({ root, result: await walk(root, { excludeRoots, scope: config.scope.decisions, onFile }) });
    log?.(`[time] walk ${root} ms=${Date.now() - t} files=${walks[walks.length - 1].result.entries.length}`);
  }
  progress.local("walk", found, found);
  return walks;
}

export function formatScopeSummary(s: ScopeSummary): string {
  return `폴더 범위: 포함 ${s.included}, 제외 ${s.excluded}, 나중에 ${s.later}`;
}
const label = (d: ScopeDecided) => `${d.decision === "include" ? "포함" : "제외"} (${d.by === "user" ? "사용자" : "LLM"})`;
export const formatDecided = (d: ScopeDecided) => `- ${d.path.replace(/\r?\n|\r/g, " ")} — ${label(d)}`;

export type ScopeCommandOptions = {
  list?: boolean; reset?: string; yes?: boolean; logPrompts?: boolean; budget?: number;
  /** 결과 폴더(init에서 방금 저장한 곳). 없으면 resolveOutputDir */
  outputDir?: string;
  /** 테스트용: 질의·확인 교체 */
  askFolder?: ScopeAsk; confirm?: (msg: string) => Promise<boolean>;
};

/** `mp scope [--list] [--reset <경로>]` (4장, 5.5). init 끝에서도 호출한다. */
export async function runScopeCommand(opts: ScopeCommandOptions): Promise<number> {
  const out = opts.outputDir ?? (await resolveOutputDir());
  if (!out) { console.error("먼저 `mp init`을 실행하세요."); return 2; }
  const config = await loadConfig(out);
  const foreign = foreignConfigMessage(config.scanFolders);
  if (foreign && !opts.list) { console.error(foreign); return 2; }
  const decisions = config.scope.decisions;
  if (opts.list) {
    const keys = Object.keys(decisions).sort();
    if (!keys.length) { console.log("저장된 폴더 범위 판단이 없습니다."); return 0; }
    for (const k of keys) {
      const d = decisions[k];
      console.log(`${d.decision === "include" ? "포함" : "제외"}\t${d.by === "user" ? "사용자" : "LLM"}\t${d.at}\t${k}`);
    }
    return 0;
  }
  if (opts.reset !== undefined) {
    const p = normalizeFolderInput(opts.reset);
    if (!p) { console.error("--reset에 경로를 입력하세요."); return 2; }
    const removed = resetScopeDecisions(decisions, p);
    await saveConfig(out, config);
    console.log(`판단 ${removed.length}개를 지웠습니다${removed.length ? `: ${removed.join(", ")}` : ""}. 다음 \`mp scope\` 또는 \`mp scan\`에서 다시 판단합니다.`);
    return 0;
  }
  const walks = await walkScanFolders(config, out);
  const folders = await collectScopeFolders(walks.map((w) => ({ root: w.root, entries: w.result.entries })), config, { nameSafe: contentNameCheck(extractorFor) });
  if (!folders.length) { console.log("판단이 없는 새 폴더가 없습니다."); return 0; }
  if (!config.agents[config.agent]) { console.error(`에이전트 설정 없음 — '${config.agent}'. \`mp init\`을 다시 실행하세요.`); return 3; }
  const logDir = join(out, ".mp", "logs");
  await mkdir(logDir, { recursive: true });
  const stamp = isoNow().slice(0, 16).replace(/[T:]/g, "-");
  const append = (p: string, l: string) => { try { appendFileSync(p, l); } catch { /* 로그 실패는 무시 */ } };
  const logPath = join(logDir, `scope-${stamp}.log`);
  const log = (l: string) => append(logPath, l + "\n");
  const promptLog = opts.logPrompts ? join(logDir, `prompts-scope-${stamp}.txt`) : null;
  const ask = opts.confirm ?? ((message: string) => inqConfirm({ message, default: true }));
  const runner = createStageRunner(config, {
    log, logPrompt: promptLog ? (t) => append(promptLog, t + "\n\n=====\n\n") : null,
    budget: opts.budget, yes: opts.yes, ask, resumeCommand: "mp scope",
  });
  const interactive = !opts.yes && (opts.askFolder !== undefined || process.stdin.isTTY === true);
  console.log(`판단이 없는 폴더 ${folders.length}개의 범위를 ${config.agent}로 정리합니다(폴더 경로·파일 이름 예시만 전송).`);
  const { stopped, summary } = await runScopeStage(config, folders, {
    runner, log, ask: interactive ? (opts.askFolder ?? terminalScopeAsk) : null, save: () => saveConfig(out, config),
  });
  runner.logSummary();
  console.log(formatScopeSummary(summary));
  for (const d of summary.decided) console.log(formatDecided(d));
  if (stopped) { console.log(scopeStopReason(stopped, runner, config.agent, summary.later)); return 3; }
  return 0;
}
