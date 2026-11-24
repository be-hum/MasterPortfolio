import type { SanitizedText } from "../privacy/sanitized.js";
export type BatchItem = { id: string; relPath: SanitizedText; format: string; modified: string; text: SanitizedText };

export function makeBatches(items: BatchItem[], batchChars: number): BatchItem[][] {
  const out: BatchItem[][] = [];
  let cur: BatchItem[] = [], size = 0;
  for (const it of items) {
    if (cur.length && size + it.text.length > batchChars) { out.push(cur); cur = []; size = 0; }
    cur.push(it); size += it.text.length;
  }
  if (cur.length) out.push(cur);
  return out;
}
