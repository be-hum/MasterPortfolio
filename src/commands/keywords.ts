import { appendFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { confirm as inqConfirm } from "@inquirer/prompts";
import { loadConfig } from "../config/config.js";
import { resolveOutputDir } from "../core/paths.js";
import { createStageRunner } from "../agent/runner.js";
import { generateKeywords, type KeywordItem } from "../analyzer/keywords.js";
import { listExperiences } from "../store/experiences.js";
import { CORRUPT_STATE_MSG, loadState, saveState } from "../store/state.js";
import { isoNow } from "../store/cards.js";

export type KeywordsOptions = { all?: boolean; yes?: boolean; logPrompts?: boolean; budget?: number; confirm?: (m: string) => Promise<boolean> };

export async function runKeywords(opts: KeywordsOptions): Promise<{ code: number; saved: string[]; skipped: string[] }> {
  const res = { code: 0, saved: [] as string[], skipped: [] as string[] };
  const out = await resolveOutputDir();
  if (!out) { console.error("먼저 `mp init`을 실행하세요."); return { ...res, code: 2 }; }
  const config = await loadConfig(out);
  const { state, problem } = await loadState(out);
  if (problem === "corrupt") { console.error(CORRUPT_STATE_MSG); return { ...res, code: 2 }; }
  const ask = opts.confirm ?? ((message: string) => inqConfirm({ message, default: true }));

  const targets = (await listExperiences(out, state)).filter((e) =>
    !e.edited && e.fm.review !== "excluded" && (opts.all || (e.fm.keywords.length === 0 && e.fm.outcome_keywords.length === 0)));
  if (!targets.length) { console.log("키워드를 만들 경험이 없습니다."); return res; }
  if (!config.agents[config.agent]) { console.error(`에이전트 설정 없음 — '${config.agent}'.`); return { ...res, code: 3 }; }

  const logDir = join(out, ".mp", "logs"); await mkdir(logDir, { recursive: true });
  const stamp = isoNow().slice(0, 16).replace(/[T:]/g, "-");
  const append = (p: string, l: string) => { try { appendFileSync(p, l); } catch { /* 무시 */ } };
  const log = (l: string) => append(join(logDir, `keywords-${stamp}.log`), l + "\n");
  const promptLog = opts.logPrompts ? join(logDir, `prompts-keywords-${stamp}.txt`) : null;
  const runner = createStageRunner(config, {
    log, logPrompt: promptLog ? (t) => append(promptLog, t + "\n\n=====\n\n") : null,
    budget: opts.budget, yes: opts.yes, ask, resumeCommand: "mp keywords",
  });
  runner.ranStages.add("keywords");
  const done = new Set<string>();
  const items: KeywordItem[] = targets.map((exp, i) => ({ id: `k${i + 1}`, exp }));
  const run = (its: KeywordItem[]) => runner.withBridge("keywords", (bridge) => generateKeywords(bridge, out, state, its, {
    timeoutMs: config.limits.batchTimeoutMs,
    onSaved: (rel) => { res.saved.push(rel); done.add(rel); },
    onSkipped: (rel) => { res.skipped.push(rel); done.add(rel); },
    onPrompt: runner.onPromptFor("keywords"), onBatch: runner.onBatchFor("keywords"),
    onUnparsed: (t) => log(`[unparsed keywords reply] ${JSON.stringify(t.slice(0, 300))}`),
    ...runner.budgetHooks("keywords", bridge),
  }));
  let r = await run(items);
  if (r.stopped?.kind === "crash") {
    log(`[restart keywords] ${r.stopped.detail}`);
    const left = items.filter((i) => !done.has(i.exp.rel));
    if (left.length) r = await run(left);
  }
  await saveState(out, state);
  runner.logSummary();
  console.log(`키워드 ${res.saved.length}개 경험, 편집돼 건너뜀 ${res.skipped.length}개`);
  if (r.stopped) {
    const left = items.length - done.size;
    console.log(r.stopped.kind === "budget" ? runner.budgetReason(r.stopped, `키워드 대기 ${left}개`)
      : r.stopped.kind === "rate_limit" ? `사용량 한도 — 키워드 대기 ${left}개. 나중에 \`mp keywords\`를 다시 실행하세요.`
      : r.stopped.kind === "auth" ? `로그인 필요 — ${config.agent} CLI에서 로그인한 뒤 다시 실행하세요.`
      : `에이전트 오류 — ${r.stopped.detail}`);
    res.code = 3;
  }
  return res;
}
