import { appendFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { checkbox, confirm as inqConfirm, input } from "@inquirer/prompts";
import { loadConfig } from "../config/config.js";
import { resolveOutputDir } from "../core/paths.js";
import { createStageRunner } from "../agent/runner.js";
import { applyReviews, applyTargets, type ApplyItem } from "../analyzer/reviewApply.js";
import { acceptExperienceEdit, listExperiences, saveExperience } from "../store/experiences.js";
import { CORRUPT_STATE_MSG, loadState, saveState } from "../store/state.js";
import { ensureBaseQuestions, evidenceModified } from "../review/baseQuestions.js";
import { isoNow } from "../store/cards.js";
import { decisionTargets, questionTargets, runReviewSession, type ReviewIO } from "../review/session.js";
import { applyReviewFile, readReviewFile, writeReviewFile, REVIEW_FILE } from "../review/reviewFile.js";

export type ReviewOptions = {
  file?: boolean; apply?: boolean; all?: boolean; acceptEdits?: boolean; yes?: boolean; logPrompts?: boolean; budget?: number; applyOnly?: boolean;
  io?: ReviewIO; confirm?: (m: string) => Promise<boolean>;
};

/** Ctrl+C(@inquirer ExitPromptError)는 그만두기(null)로 */
async function quitOnExit<T>(f: () => Promise<T>): Promise<T | null> {
  try { return await f(); } catch (e) { if (e instanceof Error && e.name === "ExitPromptError") return null; throw e; }
}

export const terminalIO: ReviewIO = {
  show: (t) => console.log(t),
  answer: async (q) => {
    const v = await quitOnExit(() => input({ message: `${q} (Enter=건너뛰기, 모름, /q=그만)` }));
    return v === null || v.trim() === "/q" ? null : v;
  },
  decideMany: async (items) => {
    const choices = items.map((i) => ({ name: i.label, value: i.rel }));
    const adopted = await quitOnExit(() => checkbox<string>({ message: "채택할 경험을 고르세요 (스페이스로 선택, Enter로 확정)", choices, pageSize: 20 }));
    if (adopted === null) return null;
    const a = new Set(adopted);
    const rest = choices.filter((c) => !a.has(c.value));
    let excluded: string[] = [];
    if (rest.length) {
      const x = await quitOnExit(() => checkbox<string>({ message: "제외할 경험을 고르세요 (나머지는 보류)", choices: rest, pageSize: 20 }));
      if (x === null) return null;
      excluded = x;
    }
    return { adopted: a, excluded: new Set(excluded) };
  },
};

export async function runReview(opts: ReviewOptions): Promise<{ code: number; applied: string[]; skipped: string[] }> {
  const res = { code: 0, applied: [] as string[], skipped: [] as string[] };
  const out = await resolveOutputDir();
  if (!out) { console.error("먼저 `mp init`을 실행하세요."); return { ...res, code: 2 }; }
  const config = await loadConfig(out);
  const { state, problem } = await loadState(out);
  if (problem === "corrupt") { console.error(CORRUPT_STATE_MSG); return { ...res, code: 2 }; }
  const ask = opts.confirm ?? ((message: string) => inqConfirm({ message, default: true }));
  const note = `review.md에는 마스킹 전 답변이 남아 있습니다. 반영이 끝났으면 지워도 됩니다: ${join(out, REVIEW_FILE)}`;

  if (opts.acceptEdits) {
    const edited = (await listExperiences(out, state)).filter((e) => e.edited);
    if (!edited.length) { console.log("바깥에서 편집된 경험 카드가 없습니다."); return res; }
    console.log("바깥에서 편집된 경험 카드:");
    for (const e of edited) console.log(`- ${e.rel} (${e.fm.title})`);
    if (!opts.yes && !(await ask(`이 ${edited.length}개 카드의 현재 내용을 그대로 받아들여 다시 질의응답·반영 대상으로 할까요?`))) return res;
    for (const e of edited) await acceptExperienceEdit(out, state, e);
    console.log(`편집 수용: ${edited.length}개`);
    return res;
  }

  // 마이그레이션: 옛 카드에 기본 질문(기여도·기간)을 덧붙인다
  for (const e of await listExperiences(out, state)) {
    if (e.edited || e.fm.review === "excluded") continue;
    const next = ensureBaseQuestions(e.fm, evidenceModified(state, e.fm.evidence));
    if (next !== e.fm) await saveExperience(out, state, e, next);
  }

  if (opts.applyOnly) {
    // 질의응답 없이 반영 단계만
  } else if (opts.file) {
    const exps = await listExperiences(out, state);
    const decisions = decisionTargets(exps, !!opts.all), questions = questionTargets(exps);
    if (!decisions.length && !questions.length) { console.log("질문할 경험이 없습니다. 먼저 `mp group`을 실행하세요."); return res; }
    const path = await writeReviewFile(out, decisions, questions);
    console.log(`설문 파일을 썼습니다: ${path}\n답을 채운 뒤 \`mp review --apply\`를 실행하세요.`);
    console.log(note);
    return res;
  } else if (opts.apply) {
    let text: string;
    try { text = await readReviewFile(out); } catch { console.error("review.md가 없습니다. 먼저 `mp review --file`을 실행하세요."); return { ...res, code: 2 }; }
    const r = await applyReviewFile(out, state, text);
    console.log(`설문 반영: ${r.applied.length}개`);
    for (const p of r.problems) console.log(`- 건너뜀: ${p}`);
    if (r.newlyAdoptedWithQuestions > 0) console.log(`새로 채택한 경험 ${r.newlyAdoptedWithQuestions}개에 질문이 있습니다. \`mp review --file\`을 다시 실행하세요.`);
    await saveState(out, state);
    console.log(note);
  } else {
    const exps = await listExperiences(out, state);
    if (decisionTargets(exps, !!opts.all).length || questionTargets(exps).length) {
      console.log(`답변은 마스킹(주민번호·카드·계좌·여권·전화번호) 후 ${config.agent}로 전송됩니다.`);
      if (!opts.all) for (const e of exps.filter((x) => x.fm.value === "하" && x.fm.review !== "excluded")) console.log(`- 가치 '하'라 건너뜀: ${e.fm.title}`);
      await runReviewSession(out, state, exps, !!opts.all, opts.io ?? terminalIO);
      await saveState(out, state);
    }
  }

  // 반영 단계(이전 실행에서 남은 pending_apply 포함)
  const pending = applyTargets(await listExperiences(out, state));
  if (!pending.length) return res;
  if (!config.agents[config.agent]) { console.error(`에이전트 설정 없음 — '${config.agent}'.`); return { ...res, code: 3 }; }
  const logDir = join(out, ".mp", "logs"); await mkdir(logDir, { recursive: true });
  const stamp = isoNow().slice(0, 16).replace(/[T:]/g, "-");
  const append = (p: string, l: string) => { try { appendFileSync(p, l); } catch { /* 무시 */ } };
  const log = (l: string) => append(join(logDir, `review-${stamp}.log`), l + "\n");
  const promptLog = opts.logPrompts ? join(logDir, `prompts-review-${stamp}.txt`) : null;
  const runner = createStageRunner(config, {
    log, logPrompt: promptLog ? (t) => append(promptLog, t + "\n\n=====\n\n") : null,
    budget: opts.budget, yes: opts.yes, ask, resumeCommand: "mp review",
  });
  runner.ranStages.add("review");
  const done = new Set<string>();
  const items: ApplyItem[] = pending.map((exp, i) => ({ id: `x${i + 1}`, exp }));
  const run = (its: ApplyItem[]) => runner.withBridge("review", (bridge) => applyReviews(bridge, out, state, its, {
    timeoutMs: config.limits.batchTimeoutMs,
    onApplied: (rel) => { res.applied.push(rel); done.add(rel); },
    onSkipped: (rel) => { res.skipped.push(rel); done.add(rel); },
    onPrompt: runner.onPromptFor("review"), onBatch: runner.onBatchFor("review"),
    onUnparsed: (t) => log(`[unparsed apply reply] ${JSON.stringify(t.slice(0, 300))}`),
    ...runner.budgetHooks("review", bridge),
  }));
  let r = await run(items);
  if (r.stopped?.kind === "crash") {
    log(`[restart review] ${r.stopped.detail}`);
    const left = items.filter((i) => !done.has(i.exp.rel));
    if (left.length) r = await run(left);
  }
  await saveState(out, state);
  runner.logSummary();
  console.log(`반영 ${res.applied.length}개, 편집돼 건너뜀 ${res.skipped.length}개`);
  if (r.stopped) {
    const left = items.length - done.size;
    console.log(r.stopped.kind === "budget" ? runner.budgetReason(r.stopped, `반영 대기 ${left}개`)
      : r.stopped.kind === "rate_limit" ? `사용량 한도 — 반영 대기 ${left}개. 답변은 저장되어 있으니 나중에 \`mp review\`를 다시 실행하세요.`
      : r.stopped.kind === "auth" ? `로그인 필요 — ${config.agent} CLI에서 로그인한 뒤 다시 실행하세요.`
      : `에이전트 오류 — ${r.stopped.detail}`);
    res.code = 3;
  }
  return res;
}
