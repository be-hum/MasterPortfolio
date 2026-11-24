import { extname } from "node:path";
import type { WalkEntry } from "../discovery/walk.js";
import type { Config, State } from "../core/schema.js";
import { FORMATS } from "../core/schema.js";
import { sha256File } from "../core/hash.js";
import { normalizePath } from "../core/paths.js";

export type Format = (typeof FORMATS)[number];

export const SUPPORTED_EXT: Record<string, Format> = {
  ".pdf": "pdf", ".docx": "docx", ".pptx": "pptx", ".md": "md", ".txt": "txt",
};

export type Candidate = {
  path: string; key: string; format: Format; size: number; mtimeMs: number; hash: string; duplicates: string[];
};
export type PrefilterResult = {
  candidates: Candidate[]; changed: string[]; skippedLarge: { path: string; size: number }[]; unsupported: number;
  /** 이미 카드가 있는 파일과 내용이 같은 새 경로(다시 보내지 않음) */
  knownDuplicates: { path: string; key: string; hash: string; card: string }[];
  /** 선별(triage)에서 drop된 내용과 같은 새 경로(다시 보내지 않음, 9.7 E) */
  knownIrrelevant: { path: string; key: string; hash: string }[];
};

export type PrefilterOptions = {
  /** `mp scan --retriage`: skipped_irrelevant 파일을 다시 후보로 넣는다(9.7 E) */
  retriage?: boolean;
};

export async function prefilter(entries: WalkEntry[], state: State, limits: Config["limits"], opts: PrefilterOptions = {}): Promise<PrefilterResult> {
  const res: PrefilterResult = { candidates: [], changed: [], skippedLarge: [], unsupported: 0, knownDuplicates: [], knownIrrelevant: [] };
  const byHash = new Map<string, Candidate>();
  // 이미 카드가 있는 내용의 해시 → 카드. 새 경로의 사본은 다시 분석하지 않는다.
  const cardByHash = new Map<string, string>();
  for (const f of Object.values(state.files)) {
    if (f.status === "done" && f.card && !cardByHash.has(f.source_hash)) cardByHash.set(f.source_hash, f.card);
  }
  const irrelevantHashes = new Set(opts.retriage ? [] : Object.values(state.files).filter((f) => f.status === "skipped_irrelevant").map((f) => f.source_hash));
  for (const e of entries) {
    if (e.kind === "repo") { res.unsupported++; continue; }
    const format = SUPPORTED_EXT[extname(e.path).toLowerCase()];
    if (!format) { res.unsupported++; continue; }
    if (e.size > limits.maxFileBytes) { res.skippedLarge.push({ path: e.path, size: e.size }); continue; }
    if ((format === "md" || format === "txt") && e.size < limits.minTextBytes) continue;
    let hash: string;
    try { hash = await sha256File(e.path); } catch { continue; }
    const key = normalizePath(e.path);
    const known = state.files[key];
    if (known) {
      if (known.source_hash !== hash) { res.changed.push(e.path); continue; }
      // 분석 실패(시간 초과·형식 오류 등)는 일시적일 수 있으므로 다음 스캔에서 다시 시도한다
      // 사본(duplicate)은 같은 해시의 카드가 아직 있을 때만 건너뛴다. 원본·카드가 지워졌으면 다시 분석한다.
      const orphanDuplicate = known.status === "duplicate" && !cardByHash.has(hash);
      const retriage = known.status === "skipped_irrelevant" && opts.retriage;
      if (known.status !== "analysis_failed" && !orphanDuplicate && !retriage) continue;
    }
    const card = cardByHash.get(hash);
    if (card) { res.knownDuplicates.push({ path: e.path, key, hash, card }); continue; }
    if (irrelevantHashes.has(hash)) { res.knownIrrelevant.push({ path: e.path, key, hash }); continue; }
    const dup = byHash.get(hash);
    if (dup) { dup.duplicates.push(key); continue; }
    const c: Candidate = { path: e.path, key, format, size: e.size, mtimeMs: e.mtimeMs, hash, duplicates: [] };
    byHash.set(hash, c);
    res.candidates.push(c);
  }
  return res;
}
