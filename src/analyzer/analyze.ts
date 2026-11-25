import { AgentError, type AcpBridge, type AgentReply } from "../agent/bridge.js";
import { progress } from "../core/progress.js";
import { classifyError } from "../agent/classify.js";
import type { FileExtraction } from "../core/schema.js";
import type { TokenUsage } from "../agent/usage.js";
import type { SanitizedText } from "../privacy/sanitized.js";
import type { BatchItem } from "./batch.js";
import { buildBatchPrompt, buildRetryPrompt } from "./prompt.js";
import { extractJsonArray, validateBatchReply, type ReplyValidation } from "./parse.js";

export type BridgeLike = Pick<AcpBridge, "newSession" | "prompt">;
/**
 * no_results: 회로 차단기(연속 2배치 결과 없음). 설정·모델 오류이므로 재시작해도 같으니 재시작하지 않는다.
 * budget: 사용량 예산(9.8) 도달 또는 시작 경고에서 사용자가 중단. rate_limit처럼 다음 실행에서 이어 한다.
 */
export type Stop = { kind: "rate_limit" | "auth" | "crash" | "no_results" | "budget"; detail: string };

/** 스캔 전체를 멈춰야 하는 응답이면 Stop, 아니면 null. */
function stopFor(r: AgentReply, parsed: unknown[] | null): Stop | null {
  if (r.ok) {
    // Codex는 사용량 한도 등 서비스 오류를 일반 답변 텍스트로 보낸다(M0 Task 0.2 §7).
    // 서비스 메시지처럼 보일 때만(짧고 JSON 조각이 없을 때) 분류한다. 모델 출력은 detail에 넣지 않는다.
    if (parsed !== null) return null;
    const t = r.text.trim();
    if (t.length > 500 || t.includes("{") || t.includes('"id"')) return null;
    const k = classifyError(t);
    if (k === "other") return null;
    return { kind: k, detail: k === "rate_limit" ? "에이전트가 사용량 한도/인증 오류 메시지를 반환함" : "에이전트가 인증 오류 메시지를 반환함" };
  }
  if (r.kind === "timeout" || r.kind === "other") return null;
  return { kind: r.kind, detail: r.detail };
}

export const NO_RESULTS_DETAIL = "에이전트가 연속으로 분석 결과를 돌려주지 않았습니다 (설정·모델 오류 가능). 스캔 로그를 확인하세요.";

/** 배치 실행 규칙(9.3·9.4)을 단계마다 같게 쓰기 위한 프롬프트·검증 묶음 */
export type BatchEngine<I extends { id: string }, R> = {
  buildPrompt: (batch: I[]) => string;
  buildRetry: (items: I[], errors: string[]) => string;
  validate: (raw: unknown[] | null, ids: string[]) => ReplyValidation<R>;
  /** 응답 텍스트에서 검증할 값을 꺼낸다. 기본은 첫 JSON 배열. 못 찾으면 null(회로 차단기·서비스 메시지 판별에 쓰임). */
  extract?: (text: string) => unknown[] | null;
};

export type RunOptions<R> = {
  timeoutMs: number;
  onResult: (id: string, r: R) => Promise<void>; onFailed: (id: string) => Promise<void>;
  onPrompt?: (text: string) => void;
  /** 배치 본 요청을 실제로 보낼 때마다(재요청 제외) */
  onBatch?: () => void;
  /** JSON 배열을 찾지 못한 응답 원문(로그용) */
  onUnparsed?: (text: string) => void;
} & BudgetHooks;

/** 사용량 예산(9.8) 연결점. 단계마다 같은 것을 넘긴다. */
export type BudgetHooks = {
  /** 각 배치를 보내기 전에 호출. Stop을 돌려주면 그 배치부터 보내지 않고 멈춘다. */
  beforeBatch?: () => Promise<Stop | null>;
  /** 응답을 받을 때마다(재요청 포함) 응답의 토큰 사용량과 함께 호출 */
  onUsage?: (usage: TokenUsage | undefined) => void;
};

/**
 * 배치를 차례로 보내고 검증한다. 배치마다 세션을 새로 연다(9.7 A: 앞 배치가 다시 입력되지 않게).
 * 누락 id는 같은 배치의 세션에서 1회 재요청, 다시 실패하면 onFailed.
 * rate_limit/auth/crash와 서비스 메시지는 즉시 멈추고, 연속 2배치 결과 없음은 no_results로 멈춘다.
 */
export async function runBatches<I extends { id: string }, R>(
  bridge: BridgeLike, batches: I[][], engine: BatchEngine<I, R>, opts: RunOptions<R>,
): Promise<{ stopped: Stop | null }> {
  // 회로 차단기: JSON 배열 없는 응답으로 유효 항목이 0개인 배치. 연속 2번이면 설정·모델 오류로 보고 멈춘다.
  // 보류 중인 배치는 실패로 기록하지 않고 남겨 두어 다음 스캔에서 다시 보낸다.
  let pending: string[] | null = null;
  const extract = engine.extract ?? extractJsonArray;
  const flushPending = async () => {
    if (pending) for (const id of pending) await opts.onFailed(id);
    pending = null;
  };
  progress.report(0, batches.length);
  for (let bi = 0; bi < batches.length; bi++) {
    if (bi > 0) progress.report(bi, batches.length);
    const halt = await opts.beforeBatch?.();
    if (halt) return { stopped: halt };
    let session: string;
    try { session = await bridge.newSession(); }
    catch (e) {
      const kind = e instanceof AgentError && (e.kind === "rate_limit" || e.kind === "auth") ? e.kind : "crash";
      return { stopped: { kind, detail: e instanceof Error ? e.message : String(e) } };
    }
    const batch = batches[bi];
    const ids = batch.map((b) => b.id);
    const prompt = engine.buildPrompt(batch);
    opts.onBatch?.();
    opts.onPrompt?.(prompt);
    const reply = await bridge.prompt(session, prompt, opts.timeoutMs);
    if (reply.ok) opts.onUsage?.(reply.usage);
    const parsed = reply.ok ? extract(reply.text) : null;
    if (reply.ok && parsed === null) opts.onUnparsed?.(reply.text);
    const stop = stopFor(reply, parsed);
    if (stop) return { stopped: stop };
    if (!reply.ok) { await flushPending(); for (const id of ids) await opts.onFailed(id); continue; }
    const { valid, errors, missing } = engine.validate(parsed, ids);
    for (const [id, a] of valid) await opts.onResult(id, a);
    let validCount = valid.size;
    let failedIds: string[] = [];
    if (missing.length) {
      const retryItems = batch.filter((b) => missing.includes(b.id));
      const retryPrompt = engine.buildRetry(retryItems, errors);
      opts.onPrompt?.(retryPrompt);
      const r2 = await bridge.prompt(session, retryPrompt, opts.timeoutMs);
      if (r2.ok) opts.onUsage?.(r2.usage);
      const parsed2 = r2.ok ? extract(r2.text) : null;
      if (r2.ok && parsed2 === null) opts.onUnparsed?.(r2.text);
      const stop2 = stopFor(r2, parsed2);
      if (stop2) return { stopped: stop2 };
      const v2 = r2.ok ? engine.validate(parsed2, missing) : { valid: new Map<string, R>(), missing };
      for (const [id, a] of v2.valid) await opts.onResult(id, a);
      validCount += v2.valid.size;
      failedIds = v2.missing;
    }
    if (validCount === 0 && parsed === null) {
      if (pending) return { stopped: { kind: "no_results", detail: NO_RESULTS_DETAIL } };
      pending = failedIds;
      continue;
    }
    await flushPending();
    for (const id of failedIds) await opts.onFailed(id);
  }
  progress.report(batches.length, batches.length);
  await flushPending();
  return { stopped: null };
}

/** 1단계(추출) */
export async function analyzeBatches(bridge: BridgeLike, batches: BatchItem[][], opts: RunOptions<FileExtraction> & {
  baselineSummary: SanitizedText | null;
}): Promise<{ stopped: Stop | null }> {
  return runBatches(bridge, batches, {
    buildPrompt: (b) => buildBatchPrompt(b, opts.baselineSummary),
    buildRetry: buildRetryPrompt,
    validate: validateBatchReply,
  }, opts);
}
