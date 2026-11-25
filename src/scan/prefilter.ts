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
  /** 문서지만 아직 읽지 못하는 형식(HWP·옛 Office): PDF로 내보내면 분석할 수 있다고 알린다 */
  unreadable: string[];
};

/** 이력서 자료일 수 있지만 아직 텍스트를 뽑지 못하는 문서 형식 */
export const UNREADABLE_DOC_EXT = new Set([".hwp", ".hwpx", ".doc", ".ppt"]);

export type PrefilterOptions = {
  /** 진행률 표시용: 확인한 항목 수 / 전체 */
  onProgress?: (done: number, total: number) => void;
  /** `mp scan --retriage`: skipped_irrelevant 파일을 다시 후보로 넣는다(9.7 E) */
  retriage?: boolean;
  /** 테스트용: 파일 해시 함수 */
  hashFile?: (path: string) => Promise<string>;
};

export async function prefilter(entries: WalkEntry[], state: State, limits: Config["limits"], opts: PrefilterOptions = {}): Promise<PrefilterResult> {
  const res: PrefilterResult = { candidates: [], changed: [], skippedLarge: [], unsupported: 0, knownDuplicates: [], knownIrrelevant: [], unreadable: [] };
  const byHash = new Map<string, Candidate>();
  // 이미 카드가 있는 내용의 해시 → 카드. 새 경로의 사본은 다시 분석하지 않는다.
  const cardByHash = new Map<string, string>();
  for (const f of Object.values(state.files)) {
    if (f.status === "done" && f.card && !cardByHash.has(f.source_hash)) cardByHash.set(f.source_hash, f.card);
  }
  const irrelevantHashes = new Set(opts.retriage ? [] : Object.values(state.files).filter((f) => f.status === "skipped_irrelevant").map((f) => f.source_hash));
  // 해시 캐시: 크기·수정 시각이 지난번과 같으면 파일을 읽지 않는다. 이번에 해시를 본 파일로 새로 채운다(사라진 파일은 빠짐)
  const oldCache = state.hash_cache ?? {};
  const cache: NonNullable<State["hash_cache"]> = {};
  const hashFile = opts.hashFile ?? sha256File;
  let seen = 0;
  for (const e of entries) {
    if (++seen % 50 === 0) opts.onProgress?.(seen, entries.length);
    if (e.kind === "repo") { res.unsupported++; continue; }
    const ext = extname(e.path).toLowerCase();
    const format = SUPPORTED_EXT[ext];
    if (!format) { res.unsupported++; if (UNREADABLE_DOC_EXT.has(ext)) res.unreadable.push(e.path); continue; }
    if (e.size > limits.maxFileBytes) { res.skippedLarge.push({ path: e.path, size: e.size }); continue; }
    if ((format === "md" || format === "txt") && e.size < limits.minTextBytes) continue;
    const key = normalizePath(e.path);
    const hit = oldCache[key];
    let hash: string;
    if (hit && hit.size === e.size && hit.mtime_ms === e.mtimeMs) hash = hit.hash;
    else { try { hash = await hashFile(e.path); } catch { continue; } }
    cache[key] = { hash, size: e.size, mtime_ms: e.mtimeMs };
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
  opts.onProgress?.(entries.length, entries.length);
  state.hash_cache = cache;
  return res;
}
