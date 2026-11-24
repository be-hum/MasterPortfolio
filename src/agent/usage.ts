/** 에이전트가 알려 주는 사용량(스펙 9.8). */

/** session/prompt 응답의 usage */
export type TokenUsage = { inputTokens: number; outputTokens: number; cachedReadTokens: number; cachedWriteTokens: number; totalTokens: number };
/** 5시간 사용량 창. utilization 0~1, resetsAt 유닉스 초(없으면 null) */
export type FiveHour = { utilization: number; resetsAt: number | null };

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** session/prompt 응답에서 usage를 꺼낸다. 없거나 형식이 다르면 undefined. 빠진 숫자는 0. */
export function parseTokenUsage(res: unknown): TokenUsage | undefined {
  const u = obj(obj(res)?.usage);
  if (!u) return undefined;
  const g = (k: string) => num(u[k]) ?? 0;
  const t: TokenUsage = { inputTokens: g("inputTokens"), outputTokens: g("outputTokens"), cachedReadTokens: g("cachedReadTokens"), cachedWriteTokens: g("cachedWriteTokens"), totalTokens: g("totalTokens") };
  return t;
}

/**
 * usage_update 알림의 _meta에서 5시간 창 정보를 꺼낸다(claude-agent-acp: `_claude/rateLimit`).
 * unifiedWindows.five_hour를 먼저 보고, 없으면 rateLimitType이 five_hour일 때 최상위 utilization을 쓴다.
 * 모델·비용만 담은 알림이면 null.
 */
export function parseFiveHour(meta: unknown): FiveHour | null {
  const rl = obj(obj(meta)?.["_claude/rateLimit"]);
  if (!rl) return null;
  const w = obj(obj(rl.unifiedWindows)?.five_hour);
  const wu = num(w?.utilization);
  if (w && wu !== null) return { utilization: wu, resetsAt: num(w.resetsAt) ?? num(rl.resetsAt) };
  const u = num(rl.utilization);
  if (rl.rateLimitType === "five_hour" && u !== null) return { utilization: u, resetsAt: num(rl.resetsAt) };
  return null;
}
