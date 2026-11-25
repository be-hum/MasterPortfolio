import { appendFileSync } from "node:fs";
import { progress } from "../core/progress.js";
import { access, constants, mkdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { confirm as inqConfirm } from "@inquirer/prompts";
import { foreignConfigMessage, resolveOutputDir, normalizePath } from "../core/paths.js";
import { loadConfig, saveConfig } from "../config/config.js";
import { checkConsistency, applyReconciliation, type Issue } from "../store/reconcile.js";
import { saveState } from "../store/state.js";
import type { WalkEntry } from "../discovery/walk.js";
import { collectScopeFolders, contentNameCheck } from "../scan/scopeCandidates.js";
import { runScopeStage, scopeStopReason, terminalScopeAsk, walkScanFolders, type ScopeAsk } from "./scope.js";
import { prefilter, type Candidate } from "../scan/prefilter.js";
import { isSensitivePath } from "../privacy/sensitivePath.js";
import { detectSecret } from "../privacy/secrets.js";
import { sanitize } from "../privacy/mask.js";
import { truncateSanitized, headSanitized } from "../privacy/sanitized.js";
import { triageFiles, TRIAGE_HEAD_CHARS, type TriageItem } from "../analyzer/triage.js";
import { extractorFor as defaultExtractorFor } from "../extractors/registry.js";
import type { ExtractResult } from "../extractors/types.js";
import { makeBatches, type BatchItem } from "../analyzer/batch.js";
import { analyzeBatches, type Stop } from "../analyzer/analyze.js";
import { createStageRunner } from "../agent/runner.js";
import { collectUnjudged, judgeCards, JUDGE_BATCH_SIZE, type JudgeItem } from "../analyzer/judge.js";
import { writeFileCard, setCardJudgement, isoNow, localDate } from "../store/cards.js";
import { writeIndex } from "../store/indexMd.js";
import { writeScanReport, type ScanReport } from "../store/report.js";
import type { FileStatus } from "../core/schema.js";

const describeIssue = (i: Issue): string => {
  switch (i.kind) {
    case "restore": return `state에 없던 카드 복원: ${i.card}`;
    case "edited": return `사용자 편집 감지: ${i.card} (${i.changedFields.join(", ")}) — 보호할까요?`;
    case "orphan_state": return `카드 파일 없음: ${i.card} — 다음 스캔에서 다시 생성할까요?`;
    case "source_missing": return `원본 없음: ${i.key} — 카드를 유지할까요?`;
  }
};

export type ScanOptions = {
  limit?: number; yes?: boolean; logPrompts?: boolean; confirm?: (msg: string) => Promise<boolean>;
  /** false면 0단계 선별을 건너뛴다(`--no-triage`, 9.7 E). 기본 true */
  triage?: boolean;
  /** skipped_irrelevant 파일을 다시 후보로 넣는다(`--retriage`, 9.7 E) */
  retriage?: boolean;
  /** 이번 실행의 5시간 창 사용량 예산(0~1, `--budget`, 9.8). 없으면 config.budget.fiveHourShare */
  budget?: number;
  /** 폴더 범위 질의(5.5). 없으면 터미널에서 묻고, --yes·비대화형이면 모두 s(나중에) */
  askScope?: ScopeAsk;
  /** 테스트용: 추출기 선택 교체 */
  extractorFor?: typeof defaultExtractorFor;
};

export async function runScan(opts: ScanOptions): Promise<{ code: number; report: ScanReport | null }> {
  const ask = opts.confirm ?? ((message: string) => inqConfirm({ message, default: true }));
  const extractorFor = opts.extractorFor ?? defaultExtractorFor;
  const out = await resolveOutputDir();
  if (!out) { console.error("먼저 `mp init`을 실행하세요."); return { code: 2, report: null }; }
  const config = await loadConfig(out);
  const foreign = foreignConfigMessage(config.scanFolders);
  if (foreign) { console.error(foreign); return { code: 2, report: null }; }
  const startedAt = isoNow();
  const startedMs = Date.now();
  const stamp = startedAt.slice(0, 16).replace(/[T:]/g, "-");
  const logDir = join(out, ".mp", "logs");
  const report: ScanReport = {
    startedAt, created: [], changed: [], skippedSensitive: [], skippedLarge: [], skippedLong: [],
    extractFailed: [], analysisFailed: [], inaccessible: [], unsupported: 0, stoppedReason: null, knownDuplicates: [],
    generatedExcluded: 0, skippedIrrelevant: [],
  };
  try { await mkdir(logDir, { recursive: true }); await access(out, constants.W_OK); }
  catch (e) {
    report.stoppedReason = `결과 폴더에 쓸 수 없음 — ${out} (${e instanceof Error ? e.message : String(e)}). 권한을 확인하거나 \`mp init\`으로 다른 폴더를 지정하세요.`;
    console.error(report.stoppedReason);
    try { await writeScanReport(out, report); } catch { /* 보고서도 쓸 수 없음 */ }
    return { code: 3, report };
  }
  const logPath = join(logDir, `scan-${stamp}.log`);
  const append = (p: string, l: string) => { try { appendFileSync(p, l); } catch { /* 로그 실패는 무시 */ } };
  const log = (l: string) => append(logPath, l + "\n");

  // 1. 정합성
  let { state, issues, problem } = await checkConsistency(out);
  if (issues.length || problem === "corrupt") {
    if (problem === "corrupt") console.log("state.json이 손상되어 카드에서 다시 구성합니다.");
    console.log(`카드와 state.json이 일치하지 않는 항목 ${issues.length}개를 찾았습니다.`);
    for (const i of issues) console.log(`- ${describeIssue(i)}`);
    // --yes: 보수적 기본값(보호/유지/재생성) = true
    state = await applyReconciliation(out, state, issues, async (i) => (opts.yes ? true : ask(describeIssue(i))));
  }

  let code = 0;
  const agentCfg = config.agents[config.agent];
  const promptLog = opts.logPrompts ? join(logDir, `prompts-${stamp}.txt`) : null;
  // 사용량 예산(9.8): 범위·선별·추출·판정이 하나의 예산을 나눠 쓴다
  const runner = createStageRunner(config, {
    log, logPrompt: promptLog ? (t) => append(promptLog, t + "\n\n=====\n\n") : null,
    budget: opts.budget, yes: opts.yes, ask, resumeCommand: "mp scan",
  });
  const { meter, ranStages, withBridge, budgetHooks, budgetReason, onPromptFor, onBatchFor } = runner;

  // 2. 순회: 저장된 폴더 범위 판단(5.5)을 적용한다. 결과 폴더(카드·index·보고서·state)가 스캔 폴더 안에 있어도 다시 분석하지 않는다
  let walks = await walkScanFolders(config, out, log);

  // 2-1. 폴더 범위(5.5): 판단이 없는 새 폴더만. 같은 실행의 다른 단계와 사용량 예산을 공유한다(9.8)
  const scopeTargets = await collectScopeFolders(walks.map((w) => ({ root: w.root, entries: w.result.entries })), config, { nameSafe: contentNameCheck(extractorFor) });
  let scopeStop: Stop | null = null;
  if (scopeTargets.length) {
    const later = { included: 0, excluded: 0, later: scopeTargets.length, decided: [] };
    if (!agentCfg) { log("[scope skipped] 에이전트 설정 없음"); report.scope = later; }
    else if (opts.yes || (await ask(`판단이 없는 폴더 ${scopeTargets.length}개의 범위를 ${config.agent}로 정리합니다(폴더 경로·파일 이름 예시만 전송). 진행할까요?`))) {
      const scopeAsk = opts.askScope ?? (opts.yes || !process.stdin.isTTY ? null : terminalScopeAsk);
      const r = await runScopeStage(config, scopeTargets, { runner, log, ask: opts.yes ? null : scopeAsk, save: () => saveConfig(out, config) });
      report.scope = r.summary;
      scopeStop = r.stopped;
      // 새 exclude 판단을 적용해 다시 순회한다
      if (!scopeStop && r.summary.excluded) walks = await walkScanFolders(config, out, log);
    } else { log("[scope declined] 이번엔 모두 포함"); report.scope = later; }
  }
  if (scopeStop) {
    // 같은 계정이므로 다음 단계도 실패한다: 스캔 전체를 멈춘다(5.5)
    code = 3;
    report.stoppedReason = `${scopeStopReason(scopeStop, runner, config.agent, report.scope!.later)} 파일은 분석하지 않았습니다.`;
    walks = [];
  }

  const seen = new Set<string>(); const entries: WalkEntry[] = [];
  const generated = new Set<string>();
  const rootOf = new Map<string, string>();
  for (const { root, result: w } of walks) {
    report.inaccessible.push(...w.inaccessible.map(normalizePath));
    for (const g of w.generated.map(normalizePath)) {
      if (generated.has(g)) continue;
      generated.add(g); log(`[generated excluded] ${g}`);
    }
    for (const e of w.entries) {
      const k = normalizePath(e.path);
      if (seen.has(k)) continue;
      seen.add(k); entries.push(e); rootOf.set(e.path, root);
    }
  }
  report.generatedExcluded = generated.size;
  let t0 = Date.now();
  const pre = await prefilter(entries, state, config.limits, { retriage: opts.retriage, onProgress: (d, t) => progress.local("hash", d, t) });
  log(`[time] hash ms=${Date.now() - t0} entries=${entries.length} candidates=${pre.candidates.length}`);
  report.changed = pre.changed.map(normalizePath);
  report.skippedLarge = pre.skippedLarge.map((s) => ({ path: normalizePath(s.path), size: s.size }));
  report.unsupported = pre.unsupported;
  report.unreadable = pre.unreadable.map(normalizePath);

  const duplicateEntry = (hash: string) => ({ source_hash: hash, card: null, card_body_hash: null, card_snapshot: null, status: "duplicate" as const });
  for (const d of pre.knownDuplicates) {
    state.files[d.key] = duplicateEntry(d.hash);
    report.knownDuplicates!.push({ path: d.key, card: d.card });
  }

  const mark = (c: Candidate, status: FileStatus) => {
    state.files[c.key] = { source_hash: c.hash, card: null, card_body_hash: null, card_snapshot: null, status };
  };
  const irrelevantEntry = (hash: string) => ({ source_hash: hash, card: null, card_body_hash: null, card_snapshot: null, status: "skipped_irrelevant" as const });
  // 선별에서 drop된 내용과 같은 새 경로: 다시 보내지 않는다(9.7 E)
  for (const k of pre.knownIrrelevant) { state.files[k.key] = irrelevantEntry(k.hash); report.skippedIrrelevant!.push(k.key); }

  // 3. 추출·민감정보
  t0 = Date.now();
  const items: BatchItem[] = []; const byId = new Map<string, Candidate>();
  const triageById = new Map<string, TriageItem>();
  for (const c of pre.candidates) {
    const sens = isSensitivePath(c.path, config.privacy.allowPaths);
    if (sens) { report.skippedSensitive.push({ path: c.key, reason: sens }); mark(c, "skipped_sensitive"); continue; }
    const ex = extractorFor(c.format);
    let r: ExtractResult;
    try { r = ex ? await ex.extract(c.path) : { ok: false, reason: "unsupported" }; }
    catch (e) { r = { ok: false, reason: "error", detail: e instanceof Error ? e.message : String(e) }; }
    if (!r.ok) { report.extractFailed.push({ path: c.key, reason: r.reason + (r.detail ? `: ${r.detail}` : "") }); mark(c, "extract_failed"); continue; }
    // 계정 비밀값(복구 코드·개인 키·API 키)은 마스킹으로 다 가릴 수 없으므로 파일째 보내지 않는다(8.2)
    // privacy.allowPaths로 사용자가 허용한 파일은 본문 검사도 건너뛴다(경로 검사와 같은 예외)
    const allowed = config.privacy.allowPaths.map(normalizePath).includes(normalizePath(c.path));
    const secret = allowed ? null : detectSecret(r.text);
    if (secret) { report.skippedSensitive.push({ path: c.key, reason: secret }); mark(c, "skipped_sensitive"); continue; }
    const s = sanitize(r.text);
    if (s.markerRatio >= 0.8) { report.skippedSensitive.push({ path: c.key, reason: "개인정보 비율 80% 이상" }); mark(c, "skipped_sensitive"); continue; }
    if (s.text.length > config.limits.maxFileChars) { report.skippedLong.push({ path: c.key, chars: s.text.length }); mark(c, "skipped_long"); continue; }
    const id = `f${items.length + 1}`;
    byId.set(id, c);
    log(`[masked] ${c.key} ${JSON.stringify(s.counts)}`);
    // 파일 경로도 에이전트로 전송되므로 본문과 같이 마스킹한다(파일명에 전화번호·주민번호가 들어가는 경우)
    const relPath = sanitize(normalizePath(relative(rootOf.get(c.path) ?? "", c.path))).text;
    // 본문 상한(9.7 C): 전문을 마스킹한 뒤 자른다. 배치 크기도 자른 길이로 계산된다.
    items.push({ id, relPath, format: c.format, modified: localDate(c.mtimeMs), text: truncateSanitized(s.text) });
    triageById.set(id, { id, relPath, format: c.format, chars: s.text.length, head: headSanitized(s.text, TRIAGE_HEAD_CHARS) });
  }
  await saveState(out, state);
  log(`[time] text ms=${Date.now() - t0} files=${pre.candidates.length}`);

  // --limit은 선별 전에 적용한다(이번 실행에서 에이전트에 보내는 파일 수의 상한)
  const selected = opts.limit && opts.limit > 0 ? items.slice(0, opts.limit) : items;
  let batches = makeBatches(selected, config.limits.batchChars);
  const triageOn = opts.triage !== false;
  const missingAgent = () => {
    code = 3;
    report.stoppedReason ??= `에이전트 설정 없음 — '${config.agent}'. \`mp init\`을 다시 실행하세요.`;
  };

  // 판정 단계 (9.6). 원문 없이 카드 요약만 보낸다. 대상: state에서 done이고 value가 null인 카드 중 filter를 통과한 것.
  let judgedCount = 0;
  const judgeStage = async (filter: (key: string) => boolean, askFirst: boolean): Promise<Stop | null> => {
    const u = await collectUnjudged(out, state);
    const targets = u.items.filter((i) => filter(u.keyById.get(i.id)!));
    if (!targets.length) return null;
    if (!agentCfg) { missingAgent(); return { kind: "crash", detail: "에이전트 설정 없음" }; }
    if (askFirst && !opts.yes && !(await ask(`미판정 카드 ${targets.length}개를 ${config.agent}로 판정합니다(카드 요약만 전송). 진행할까요?`))) return null;
    ranStages.add("judge");
    const settled = new Set<string>();
    const runJudge = (items: JudgeItem[]) => withBridge("judge", (bridge) => judgeCards(bridge, items, {
      timeoutMs: config.limits.batchTimeoutMs, batchSize: JUDGE_BATCH_SIZE, ...budgetHooks("judge", bridge),
      onPrompt: onPromptFor("judge"), onBatch: onBatchFor("judge"),
      onUnparsed: (t) => log(`[unparsed judge reply] ${JSON.stringify(t.slice(0, 300))}`),
      onJudged: async (id, r) => {
        const key = u.keyById.get(id)!;
        const entry = state.files[key];
        settled.add(id);
        if (!entry?.card) return;
        let res: Awaited<ReturnType<typeof setCardJudgement>>;
        try { res = await setCardJudgement(out, entry.card, r, entry); }
        catch (e) { log(`[judge write failed] ${entry.card}: ${e instanceof Error ? e.message : String(e)}`); return; }
        if ("skipped" in res) { log(`[judge skipped edited] ${entry.card}`); return; }
        state.files[key] = res.entry;
        judgedCount++;
        await saveState(out, state);
      },
    }));
    let res = await runJudge(targets);
    if (res.stopped?.kind === "crash") {
      log(`[restart judge] ${res.stopped.detail}`);
      const remaining = targets.filter((i) => !settled.has(i.id));
      if (remaining.length) res = await runJudge(remaining);
    }
    if (res.stopped) {
      log(`[judge stopped] ${res.stopped.kind}: ${res.stopped.detail}`);
      if (!report.stoppedReason) {
        code = 3;
        const left = (await collectUnjudged(out, state)).total;
        report.stoppedReason = res.stopped.kind === "budget" ? budgetReason(res.stopped, `미판정 카드 ${left}개(다음 \`mp scan\`에서 먼저 판정)`)
          : res.stopped.kind === "rate_limit"
          ? `사용량 한도(판정 단계) — 판정 완료 ${judgedCount}개, 미판정 ${left}개. 다음 \`mp scan\`에서 미판정 카드부터 판정합니다.`
          : res.stopped.kind === "auth" ? `로그인 필요 — ${config.agent} CLI에서 로그인한 뒤 다시 실행하세요.`
          : `에이전트 오류(판정 단계) — ${res.stopped.detail}`;
      }
    }
    return res.stopped;
  };

  // 이전 스캔에서 미판정으로 남은 카드를 먼저 판정한다(9.6 "다음 mp scan이 먼저 판정").
  // 여기서 멈추면(사용량 한도·인증·결과 없음 등) 같은 계정·설정이므로 추출도 하지 않고 스캔을 끝낸다.
  const initial = await collectUnjudged(out, state);
  const earlier = new Set(initial.items.map((i) => initial.keyById.get(i.id)!));
  // 범위 단계에서 멈췄으면(사용량 한도·인증·예산) 판정도 하지 않는다
  // 진행률: 이전 실행에서 남은 카드 판정은 마지막 판정과 따로 센다
  progress.override("judge-pending");
  const preStop = scopeStop ?? await judgeStage((k) => earlier.has(k), true);
  progress.override(null);
  if (preStop && batches.length && report.stoppedReason) report.stoppedReason += ` 새 파일 ${selected.length}개는 분석하지 않았습니다.`;

  // 1단계: 추출
  let extractStop: Stop | null = null;
  let declined = false, consented = false;
  if (batches.length && !preStop) {
    const go = opts.yes || (await ask(`분석 후보 ${selected.length}개, 배치 ${batches.length}개를 ${config.agent}로 분석합니다${triageOn ? "(먼저 무관한 파일을 선별해 줄어들 수 있음)" : ""}. 진행할까요?`));
    if (!go) declined = true;
    else if (!agentCfg) missingAgent();
    else {
      consented = true;
      // 0단계: 선별(9.7 E). drop된 파일은 skipped_irrelevant로 기록하고, 응답을 읽지 못한 파일은 keep.
      let kept = selected;
      if (triageOn) {
        ranStages.add("triage");
        const decided = new Set<string>(), dropped = new Set<string>();
        const runTriage = (ts: TriageItem[]) => withBridge("triage", (bridge) => triageFiles(bridge, ts, {
          timeoutMs: config.limits.batchTimeoutMs, ...budgetHooks("triage", bridge),
          onPrompt: onPromptFor("triage"),
          onBatch: onBatchFor("triage"),
          onUnparsed: (t) => log(`[unparsed triage reply] ${JSON.stringify(t.slice(0, 300))}`),
          onDrop: async (id) => {
            const c = byId.get(id)!; dropped.add(id); decided.add(id);
            mark(c, "skipped_irrelevant"); report.skippedIrrelevant!.push(c.key);
            for (const k of c.duplicates) { state.files[k] = irrelevantEntry(c.hash); report.skippedIrrelevant!.push(k); }
            log(`[triage drop] ${c.key}`);
            await saveState(out, state);
          },
        }));
        const triageItems = selected.map((i) => triageById.get(i.id)!);
        let tres = await runTriage(triageItems);
        if (tres.stopped?.kind === "crash") {
          log(`[restart triage] ${tres.stopped.detail}`);
          // 재시작 후에는 아직 drop되지 않은 파일을 다시 선별한다(keep 결과는 따로 기록하지 않으므로)
          tres = await runTriage(triageItems.filter((t) => !decided.has(t.id)));
        }
        if (tres.stopped?.kind === "no_results") {
          // 선별 응답을 읽지 못하면 안전 쪽(keep)으로 진행한다
          log(`[triage unscreened] ${tres.stopped.detail}`);
          tres = { stopped: null };
        }
        if (tres.stopped) {
          extractStop = tres.stopped;
          code = 3;
          log(`[triage stopped] ${tres.stopped.kind}: ${tres.stopped.detail}`);
          report.stoppedReason = tres.stopped.kind === "budget" ? budgetReason(tres.stopped, `남은 파일 ${selected.length - dropped.size}개`)
            : tres.stopped.kind === "rate_limit"
            ? `사용량 한도(선별 단계) — 새 파일 ${selected.length - dropped.size}개는 분석하지 않았습니다. 나중에 \`mp scan\`으로 이어서 처리하세요.`
            : tres.stopped.kind === "auth" ? `로그인 필요 — ${config.agent} CLI에서 로그인한 뒤 다시 실행하세요.`
            : `에이전트 오류(선별 단계) — ${tres.stopped.detail}`;
          kept = [];
        } else kept = selected.filter((i) => !dropped.has(i.id));
        batches = makeBatches(kept, config.limits.batchChars);
      }
      if (!extractStop && batches.length) {
        ranStages.add("extract");
        const done = new Set<string>();
        const run = (bs: BatchItem[][]) => {
          for (const [bi, b] of bs.entries()) log(`[batch ${bi + 1}] ${b.map((i) => `${i.id}=${byId.get(i.id)!.key}`).join(", ")}`);
          return withBridge("extract", (bridge) => analyzeBatches(bridge, bs, {
            timeoutMs: config.limits.batchTimeoutMs, baselineSummary: null, ...budgetHooks("extract", bridge),
            onPrompt: onPromptFor("extract"), onBatch: onBatchFor("extract"),
            onUnparsed: (t) => log(`[unparsed reply] ${JSON.stringify(t.slice(0, 300))}`),
            onResult: async (id, a) => {
              const c = byId.get(id)!; done.add(id);
              // 카드는 미판정(value null)으로 바로 저장한다. 판정 단계가 멈춰도 추출 결과는 남는다(9.6).
              const { relPath, entry } = await writeFileCard(out, c, a, config.agent);
              state.files[c.key] = entry; report.created.push(relPath);
              // 같은 스캔에서 찾은 사본은 카드 duplicates에 적혔으므로 다음 스캔에서 다시 보내지 않도록 기록한다
              for (const k of c.duplicates) state.files[k] = duplicateEntry(c.hash);
              await saveState(out, state);
            },
            onFailed: async (id) => {
              const c = byId.get(id)!; done.add(id);
              mark(c, "analysis_failed"); report.analysisFailed.push(c.key);
              await saveState(out, state);
            },
          }));
        };
        // Ctrl+C: 별도 핸들러 없음. 진행 중이던 배치 결과는 버려지고(다음 스캔에서 다시 전송),
        // 이미 저장된 카드·state는 남는다. 카드 파일을 쓴 직후 state 저장 전에 중단되면
        // 다음 스캔의 정합성 검사(reconcile restore)가 그 카드를 state에 복원한다.
        let res = await run(batches);
        // 스펙 §9.4: 에이전트가 죽으면 1회 재시작해 남은 배치를 처리한다.
        // no_results(회로 차단기)는 설정·모델 오류라 재시작해도 같으므로 재시작하지 않는다.
        if (res.stopped?.kind === "crash") {
          log(`[restart] ${res.stopped.detail}`);
          const remaining = batches.map((b) => b.filter((i) => !done.has(i.id))).filter((b) => b.length);
          if (remaining.length) res = await run(remaining);
        }
        extractStop = res.stopped;
        if (res.stopped) {
          code = 3;
          report.stoppedReason = res.stopped.kind === "budget" ? budgetReason(res.stopped, `카드 ${report.created.length}개 생성, 남은 파일 ${kept.length - done.size}개`)
            : res.stopped.kind === "rate_limit"
            ? `사용량 한도 — 카드 ${report.created.length}개 생성, 분석 실패 ${report.analysisFailed.length}개, 남은 파일 ${kept.length - done.size}개. 나중에 \`mp scan\`으로 이어서 처리하세요.`
            : res.stopped.kind === "auth" ? `로그인 필요 — ${config.agent} CLI에서 로그인한 뒤 다시 실행하세요.`
            : `에이전트 오류 — ${res.stopped.detail}`;
        }
      }
    }
  }

  // 2단계: 이번 스캔에서 만든 카드를 판정한다. 추출이 사용량 한도·인증 오류로 멈췄다면 같은 계정이므로 시도하지 않는다.
  // 사용량 예산(9.8) 중단도 같은 계정의 예산을 공유하므로 판정하지 않는다
  const blocked = preStop !== null || declined || extractStop?.kind === "rate_limit" || extractStop?.kind === "auth" || extractStop?.kind === "budget";
  if (!blocked) await judgeStage((k) => !earlier.has(k), !consented);
  runner.logSummary();
  log(`[time] total ms=${Date.now() - startedMs}`);
  report.usage = {
    tokens: meter.tokens, share: meter.share, scale: config.budget.planScale ?? 1,
    fiveHour: meter.hasInfo ? { start: meter.start!, last: meter.last!.utilization, spent: meter.spent(), resetsAt: meter.resetsAt } : null,
  };
  const final = await collectUnjudged(out, state);
  report.judgement = { judged: judgedCount, unjudged: final.total, skippedEdited: final.edited };

  state.last_scan = startedAt;
  await saveState(out, state);
  await writeIndex(out);
  const rel = await writeScanReport(out, report);
  console.log(`신규 카드 ${report.created.length}개, 판정 완료 ${report.judgement.judged} / 미판정 ${report.judgement.unjudged}. 보고서: ${join(out, rel)}`);
  if (report.changed.length) console.log(`원본이 바뀐 파일 ${report.changed.length}개 — 보고서를 확인하세요. (\`mp rescan\`은 다음 버전에서 제공)`);
  if (report.stoppedReason) console.log(report.stoppedReason);
  progress.summary(scanSummary(report));
  return { code, report };
}

/** 화면 작업 바용 한 줄 요약. 새로 분석한 것이 없으면 그렇게 말한다 */
export function scanSummary(r: ScanReport): string {
  const parts: string[] = [];
  const n = (x: number, label: string, suffix = "") => { if (x) parts.push(`${label} ${x}개${suffix}`); };
  n(r.created.length, "새 카드");
  if (r.judgement?.judged) parts.push(`판정 ${r.judgement.judged}개`);
  n(r.changed.length, "원본이 바뀐 파일", "(아직 다시 분석하지 않음)");
  n(r.skippedIrrelevant?.length ?? 0, "무관해 보여 제외");
  n(r.skippedSensitive.length, "민감 정보로 건너뜀");
  n(r.skippedLarge.length, "크기 초과");
  n(r.skippedLong.length, "너무 긴 문서");
  n(r.analysisFailed.length + r.extractFailed.length, "분석 실패");
  const ur = r.unreadable ?? [];
  if (ur.length) {
    const by = new Map<string, number>();
    for (const p of ur) { const e = (p.match(/\.([^./\\]+)$/)?.[1] ?? "").toUpperCase(); by.set(e, (by.get(e) ?? 0) + 1); }
    parts.push(`읽지 못한 ${[...by].map(([e, c]) => `${e} ${c}개`).join("·")}(PDF로 내보내면 분석)`);
  }
  if (!r.created.length && !r.judgement?.judged) parts.unshift("새로 분석할 자료 없음");
  if (r.stoppedReason) parts.push(`중단: ${r.stoppedReason.split(/[—.]/)[0].trim()}`);
  return parts.join(" · ");
}
