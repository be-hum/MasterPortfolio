import { appendFileSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { confirm as inqConfirm } from "@inquirer/prompts";
import { loadConfig } from "../config/config.js";
import { resolveOutputDir } from "../core/paths.js";
import { FileCardFrontmatter, KEYWORD_LIMITS, VALUES, type ExperienceFrontmatter } from "../core/schema.js";
import { sanitize } from "../privacy/mask.js";
import { AgentError } from "../agent/bridge.js";
import { createStageRunner } from "../agent/runner.js";
import type { Stop } from "../analyzer/analyze.js";
import { clampKeywords } from "../analyzer/keywords.js";
import {
  groupCards, groupCardLine, makeGroupBatches, buildMergePrompt, parseMergeReply, MAX_QUESTIONS,
  type Assignment, type GroupCard, type NewExp, type QuestionDraft,
} from "../analyzer/group.js";
import { parseCard } from "../store/frontmatter.js";
import { CORRUPT_STATE_MSG, loadState, saveState } from "../store/state.js";
import { createExperience, listExperiences, saveExperience } from "../store/experiences.js";
import { ensureBaseQuestions, evidenceModified, nextQid } from "../review/baseQuestions.js";
import { isoNow } from "../store/cards.js";

export type GroupOptions = { regroup?: boolean; yes?: boolean; logPrompts?: boolean; budget?: number; confirm?: (m: string) => Promise<boolean> };
export type GroupResult = { code: number; created: string[]; attached: string[]; ungrouped: number; skippedEdited: string[] };

const best = (vs: (string | null)[]) => VALUES.find((v) => vs.includes(v)) ?? null;
const dedupe = (a: string[]) => [...new Set(a)];

function mergeExps(group: NewExp[]): NewExp {
  const [first, ...rest] = group;
  const pick = <K extends keyof NewExp>(k: K) => (first[k] ?? rest.find((r) => r[k] != null)?.[k] ?? null) as NewExp[K];
  return {
    ...first, period: pick("period"), org: pick("org"), role: pick("role"), team_size: pick("team_size"), category: pick("category"),
    keywords: clampKeywords(dedupe(group.flatMap((g) => g.keywords)), KEYWORD_LIMITS.keywords),
    outcome_keywords: clampKeywords(dedupe(group.flatMap((g) => g.outcome_keywords)), KEYWORD_LIMITS.outcome),
    skills: dedupe(group.flatMap((g) => g.skills)), metrics: dedupe(group.flatMap((g) => g.metrics)),
    questions: group.flatMap((g) => g.questions).slice(0, MAX_QUESTIONS),
  };
}

export async function runGroup(opts: GroupOptions): Promise<GroupResult> {
  const res: GroupResult = { code: 0, created: [], attached: [], ungrouped: 0, skippedEdited: [] };
  const out = await resolveOutputDir();
  if (!out) { console.error("먼저 `mp init`을 실행하세요."); return { ...res, code: 2 }; }
  const config = await loadConfig(out);
  const { state, problem } = await loadState(out);
  if (problem === "corrupt") { console.error(CORRUPT_STATE_MSG); return { ...res, code: 2 }; }
  const exps = await listExperiences(out, state);
  const inEvidence = new Set(exps.flatMap((e) => e.fm.evidence));

  // 1. 후보: done, 상/중, 경험에 없음, ungrouped 아님(--regroup이면 포함)
  const cards: GroupCard[] = []; const keyById = new Map<string, string>(); const relById = new Map<string, string>(); const valueById = new Map<string, string | null>();
  for (const [key, e] of Object.entries(state.files)) {
    if (e.status !== "done" || !e.card || inEvidence.has(e.card)) continue;
    if (e.grouping === "ungrouped" && !opts.regroup) continue;
    let fm: FileCardFrontmatter;
    try { const p = FileCardFrontmatter.safeParse(parseCard(await readFile(join(out, e.card), "utf8")).fm); if (!p.success) continue; fm = p.data; } catch { continue; }
    if (fm.value !== "상" && fm.value !== "중") continue;
    const id = `c${cards.length + 1}`;
    cards.push({ id, line: groupCardLine(fm) }); keyById.set(id, key); relById.set(id, e.card); valueById.set(id, fm.value);
  }
  if (!cards.length) { console.log("묶을 새 카드가 없습니다."); return res; }
  if (!config.agents[config.agent]) { console.error(`에이전트 설정 없음 — '${config.agent}'.`); return { ...res, code: 3 }; }
  const ask = opts.confirm ?? ((message: string) => inqConfirm({ message, default: true }));
  if (!opts.yes && !(await ask(`상·중 카드 ${cards.length}개를 ${config.agent}로 경험 단위로 묶습니다(카드 요약만 전송). 진행할까요?`))) return res;

  const logDir = join(out, ".mp", "logs"); await mkdir(logDir, { recursive: true });
  const stamp = isoNow().slice(0, 16).replace(/[T:]/g, "-");
  const append = (p: string, l: string) => { try { appendFileSync(p, l); } catch { /* 무시 */ } };
  const log = (l: string) => append(join(logDir, `group-${stamp}.log`), l + "\n");
  const promptLog = opts.logPrompts ? join(logDir, `prompts-group-${stamp}.txt`) : null;
  const runner = createStageRunner(config, {
    log, logPrompt: promptLog ? (t) => append(promptLog, t + "\n\n=====\n\n") : null,
    budget: opts.budget, yes: opts.yes, ask, resumeCommand: "mp group",
  });

  // 2. 기존 경험(제외된 것 빼고)을 e1…로
  const live = exps.filter((e) => e.fm.review !== "excluded");
  const existing = live.map((e, i) => ({ id: `e${i + 1}`, line: sanitize(JSON.stringify({ title: e.fm.title, period: e.fm.period, org: e.fm.org })).text }));
  const expById = new Map(live.map((e, i) => [`e${i + 1}`, e]));

  // 3. 실행(크래시는 남은 카드로 1회 재시작)
  const assigned = new Map<string, Assignment>();
  const batches = makeGroupBatches(cards);
  runner.ranStages.add("group");
  const run = (bs: GroupCard[][]) => runner.withBridge("group", (bridge) => groupCards(bridge, bs, existing, {
    timeoutMs: config.limits.batchTimeoutMs,
    onAssigned: async (a) => { assigned.set(a.id, a); },
    onPrompt: runner.onPromptFor("group"), onBatch: runner.onBatchFor("group"),
    onUnparsed: (t) => log(`[unparsed group reply] ${JSON.stringify(t.slice(0, 300))}`),
    ...runner.budgetHooks("group", bridge),
  }));
  let r = await run(batches);
  if (r.stopped?.kind === "crash") {
    log(`[restart group] ${r.stopped.detail}`);
    const left = batches.map((b) => b.filter((c) => !assigned.has(c.id))).filter((b) => b.length);
    if (left.length) r = await run(left);
  }

  // 4. 새 경험 모으기 + 병합(배치가 여러 개였을 때 1회)
  const newByKey = new Map<string, { exp: NewExp; ids: string[] }>();
  for (const a of assigned.values()) if (a.kind === "new") {
    const g = newByKey.get(a.exp.key) ?? { exp: a.exp, ids: [] }; g.ids.push(a.id); newByKey.set(a.exp.key, g);
  }
  let mergeStop: Stop | null = null;
  if (batches.length > 1 && newByKey.size > 1 && !r.stopped) {
    const keys = [...newByKey.keys()];
    const mr = await runner.withBridge("group", async (bridge) => {
      try {
        const s = await bridge.newSession();
        const p = buildMergePrompt(keys.map((k) => ({ ...newByKey.get(k)!.exp, key: k })));
        runner.onPromptFor("group")(p);
        const reply = await bridge.prompt(s, p, config.limits.batchTimeoutMs);
        runner.budgetHooks("group", bridge).onUsage?.(reply.ok ? reply.usage : undefined);
        if (!reply.ok) return { stopped: { kind: reply.kind === "rate_limit" || reply.kind === "auth" ? reply.kind : "crash", detail: reply.detail } as Stop };
        for (const g of parseMergeReply(reply.text, new Set(keys))) {
          const parts = g.map((k) => newByKey.get(k)!);
          newByKey.set(g[0], { exp: mergeExps(parts.map((p) => p.exp)), ids: parts.flatMap((p) => p.ids) });
          for (const k of g.slice(1)) newByKey.delete(k);
        }
        return { stopped: null as Stop | null };
      } catch (e) {
        const kind = e instanceof AgentError && (e.kind === "rate_limit" || e.kind === "auth") ? e.kind : "crash";
        return { stopped: { kind, detail: e instanceof Error ? e.message : String(e) } as Stop };
      }
    });
    if (mr.stopped) {
      log(`[merge skipped] ${mr.stopped.kind}: ${mr.stopped.detail}`);
      // 사용량 한도·로그인·예산이면 쓰고 나서 code 3, 그 밖의 병합 실패는 병합만 건너뜀
      if (mr.stopped.kind === "rate_limit" || mr.stopped.kind === "auth" || mr.stopped.kind === "budget") mergeStop = mr.stopped;
    }
  }

  // 5. 쓰기
  const toQuestions = (qs: QuestionDraft[], start: number) => qs.map((q, i) => ({ id: `q${start + i + 1}`, field: q.field, q: q.q, a: null }));
  for (const { exp, ids } of newByKey.values()) {
    const base: ExperienceFrontmatter = {
      schema_version: 1, kind: "experience", title: exp.title, type: exp.type, period: exp.period, org: exp.org, role: exp.role,
      team_size: exp.team_size, contribution: null, category: exp.category, keywords: exp.keywords, outcome_keywords: exp.outcome_keywords, skills: exp.skills, metrics: exp.metrics, value: best(ids.map((i) => valueById.get(i) ?? null)) as ExperienceFrontmatter["value"],
      value_reason: null, evidence: ids.map((i) => relById.get(i)!), in_resume: "판단불가", review: "pending",
      questions: toQuestions(exp.questions, 0), pending_apply: false, reviewed_at: null, agent: config.agent, generated_at: isoNow(),
    };
    const fm = ensureBaseQuestions(base, evidenceModified(state, base.evidence));
    res.created.push(await createExperience(out, state, fm));
  }
  const attachByExp = new Map<string, Assignment[]>();
  for (const a of assigned.values()) if (a.kind === "attach") attachByExp.set(a.experience, [...(attachByExp.get(a.experience) ?? []), a]);
  for (const [eid, as] of attachByExp) {
    const e = expById.get(eid)!;
    if (e.edited) { res.skippedEdited.push(e.rel); continue; }
    const qs = as.flatMap((a) => (a.kind === "attach" ? a.questions : []));
    const grown = { ...e.fm, evidence: dedupe([...e.fm.evidence, ...as.map((a) => relById.get(a.id)!)]), questions: [...e.fm.questions, ...toQuestions(qs, nextQid(e.fm.questions) - 1)] };
    const next = ensureBaseQuestions(grown, evidenceModified(state, grown.evidence));
    if ("ok" in (await saveExperience(out, state, e, next))) res.attached.push(...as.map((a) => relById.get(a.id)!));
    else res.skippedEdited.push(e.rel);
  }
  for (const a of assigned.values()) if (a.kind === "unassigned") { state.files[keyById.get(a.id)!].grouping = "ungrouped"; res.ungrouped++; }
  await saveState(out, state);
  runner.logSummary();

  console.log(`새 경험 ${res.created.length}개, 기존 경험에 추가 ${res.attached.length}개, 경험 아님 ${res.ungrouped}개`);
  for (const p of res.skippedEdited) console.log(`- 편집된 경험 카드라 건드리지 않음: ${p}`);
  const stop = r.stopped ?? mergeStop;
  if (stop) {
    const left = cards.length - assigned.size;
    console.log(stop.kind === "budget" ? runner.budgetReason(stop, `남은 카드 ${left}개`)
      : stop.kind === "rate_limit" ? `사용량 한도 — 남은 카드 ${left}개. 나중에 \`mp group\`으로 이어서 처리하세요.`
      : stop.kind === "auth" ? `로그인 필요 — ${config.agent} CLI에서 로그인한 뒤 다시 실행하세요.`
      : `에이전트 오류 — ${stop.detail}`);
    res.code = 3;
  }
  return res;
}
