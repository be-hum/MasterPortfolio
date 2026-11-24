import type { z } from "zod";
import { FileExtraction, JudgeResult } from "../core/schema.js";

function scanArray(s: string, start: number): string | null {
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === "[") depth++;
    else if (ch === "]" && --depth === 0) return s.slice(start, i + 1);
  }
  return null;
}

const MAX_STARTS = 200;
const hasId = (v: unknown[]) => v.length > 0 && v.every((x) => typeof x === "object" && x !== null && !Array.isArray(x) && "id" in x);

export function extractJsonArray(text: string): unknown[] | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = fence ? [fence[1], text] : [text];
  let fallback: unknown[] | null = null;
  for (const c of candidates) {
    let tried = 0;
    for (let i = c.indexOf("["); i !== -1 && tried < MAX_STARTS; i = c.indexOf("[", i + 1), tried++) {
      const slice = scanArray(c, i);
      if (!slice) continue;
      try {
        const v = JSON.parse(slice);
        if (!Array.isArray(v)) continue;
        if (hasId(v)) return v;
        fallback ??= v;
      } catch { /* try next */ }
    }
  }
  return fallback;
}

export type ReplyValidation<T> = { valid: Map<string, T>; errors: string[]; missing: string[] };

/** 응답 항목을 스키마로 검증하고, 요청한 id가 정확히 한 번씩 있는지 확인한다(9.3). */
export function validateReply<T extends { id: string }>(raw: unknown[] | null, ids: string[], schema: z.ZodType<T, z.ZodTypeDef, unknown>): ReplyValidation<T> {
  const valid = new Map<string, T>();
  const errors: string[] = [];
  if (!raw) errors.push("JSON 배열을 찾을 수 없음");
  for (const item of raw ?? []) {
    const r = schema.safeParse(item);
    const id = (item as { id?: unknown } | null)?.id;
    if (!r.success) { errors.push(`id=${String(id ?? "?")}: ${r.error.issues.map((x) => `${x.path.join(".")} ${x.message}`).join("; ")}`); continue; }
    if (!ids.includes(r.data.id)) { errors.push(`알 수 없는 id=${r.data.id}`); continue; }
    if (valid.has(r.data.id)) { errors.push(`중복 id=${r.data.id}`); continue; }
    valid.set(r.data.id, r.data);
  }
  const missing = ids.filter((id) => !valid.has(id));
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const id of missing) if (!errors.some((e) => new RegExp(`id=${esc(id)}(?![\\w-])`).test(e))) errors.push(`id=${id} 누락`);
  return { valid, errors, missing };
}

export const validateBatchReply = (raw: unknown[] | null, ids: string[]) => validateReply(raw, ids, FileExtraction);
export const validateJudgeReply = (raw: unknown[] | null, ids: string[]) => validateReply(raw, ids, JudgeResult);
