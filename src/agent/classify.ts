const RATE = /You've hit your|You've reached your|out of (extra )?usage|usage limit|rate.?limit|RESOURCE_EXHAUSTED|insufficient_quota|quota|too many requests|\b429\b/i;
const AUTH = /Authentication required|run \/login|Not logged in|Login expired|unauthori[sz]ed|\b401\b|credential/i;

export function classifyError(message: string): "rate_limit" | "auth" | "other" {
  if (RATE.test(message)) return "rate_limit";
  if (AUTH.test(message)) return "auth";
  return "other";
}

export function describeError(e: unknown): string {
  const x = e as { message?: unknown; data?: { details?: unknown; message?: unknown } } | null;
  const parts = [x?.message, x?.data?.details, x?.data?.message, x?.data ? JSON.stringify(x.data) : undefined];
  const s = parts.filter((p) => typeof p === "string" && p.length > 0).join(" | ");
  return s || String(e);
}

export function classifyRpcError(e: unknown): "rate_limit" | "auth" | "other" {
  const x = e as { code?: unknown; data?: { errorKind?: unknown } } | null;
  if (x?.data?.errorKind === "rate_limit" || x?.data?.errorKind === "billing_error") return "rate_limit";
  if (x?.data?.errorKind === "authentication_failed") return "auth";
  if (x?.code === -32000) return "auth";
  return classifyError(describeError(e));
}
