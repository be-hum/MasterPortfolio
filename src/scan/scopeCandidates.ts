import { basename, dirname, extname, relative } from "node:path";
import type { Config } from "../core/schema.js";
import { normalizePath, pathKey } from "../core/paths.js";
import type { WalkEntry } from "../discovery/walk.js";
import { findDecisionKey } from "../discovery/scopeDecisions.js";
import { isSensitiveDir, isSensitivePath } from "../privacy/sensitivePath.js";
import { sanitize } from "../privacy/mask.js";
import type { SanitizedText } from "../privacy/sanitized.js";
import { SUPPORTED_EXT, type Format } from "./prefilter.js";
import { detectSecret } from "../privacy/secrets.js";
import type { Extractor } from "../extractors/types.js";

/** 파일 이름 예시 최대 개수(5.5) */
export const SCOPE_SAMPLE_MAX = 5;

/** 범위 단계 대상 폴더 1개. relPath·samples는 마스킹된 텍스트(에이전트로 보냄), path는 로컬 표시·저장용. */
export type ScopeFolder = {
  path: string; key: string; root: string;
  relPath: SanitizedText;
  /** 폴더에 직접 든 파일(민감 파일 제외) 수와 확장자별 수 */
  fileCount: number; extCounts: Record<string, number>;
  samples: SanitizedText[];
};

const one = (t: string) => t.replace(/\r?\n|\r/g, " ");
const extOf = (p: string) => { const e = extname(p).toLowerCase(); return /^\.[a-z0-9]{1,10}$/.test(e) ? e : e ? "(기타)" : "(없음)"; };

type Limits = Pick<Config["limits"], "maxFileBytes" | "minTextBytes">;
/** 후보 파일(지원 확장자, 크기 조건 통과, 민감 경로 아님) — prefilter의 크기 규칙과 같다 */
function isCandidateFile(e: Extract<WalkEntry, { kind: "file" }>, limits: Limits, allowPaths: string[]): boolean {
  const format = SUPPORTED_EXT[extname(e.path).toLowerCase()];
  if (!format || e.size > limits.maxFileBytes) return false;
  if ((format === "md" || format === "txt") && e.size < limits.minTextBytes) return false;
  return !isSensitivePath(e.path, allowPaths);
}

/**
 * 범위 단계 대상 폴더(5.5): 순회 규칙(5.4·9.7 B)과 기존 판단이 적용된 walk 결과에서, 후보 파일이 하나라도 직접 든 폴더 중
 * 판단이 없는 것. 스캔 루트 자체와 민감 폴더(8.1·8.2.1)는 대상이 아니다(이번 실행에서 포함으로 다룬다).
 */
/**
 * 이름 예시 우선순위(작을수록 먼저). 실기 스캔에서 이름순 5개만 보내 work 폴더의 writeup-submit.md가 빠지고
 * LLM이 폴더를 제외한 일 대응: 결과물로 보이는 이름 → 문서 형식 → 그 밖, 숫자 위주 이름은 뒤로.
 */
const DELIVERABLE = /(write-?up|report|submit|final|presentation|slides?|resume|portfolio|보고서|제출|최종|발표|결과|풀이|분석|이력|자소서|포트폴리오)/i;
const DOC_EXT = /\.(pdf|docx?|pptx?|hwpx?)$/i;
export function sampleRank(name: string): number {
  let r = 2;
  if (DELIVERABLE.test(name)) r = 0;
  else if (DOC_EXT.test(name)) r = 1;
  const stem = name.replace(/\.[^.]+$/, "");
  if ((stem.match(/\d/g)?.length ?? 0) * 2 >= stem.length) r += 3;
  return r;
}

export async function collectScopeFolders(
  walks: { root: string; entries: WalkEntry[] }[],
  config: Pick<Config, "limits" | "privacy" | "scope" | "scanFolders">,
  opts: {
    platform?: NodeJS.Platform;
    /**
     * 이름을 예시로 보내도 되는가(본문 검사, 8.2.1). 이름이 멀쩡해도 본문이 복구 코드·키인 파일(예: 메모.txt)의
     * 이름은 보내지 않는다. 없으면 이름 검사만 한다.
     */
    nameSafe?: (path: string) => Promise<boolean>;
  } = {},
): Promise<ScopeFolder[]> {
  const platform = opts.platform ?? process.platform;
  const rootKeys = new Set(config.scanFolders.map((r) => pathKey(r, platform)));
  const out: ScopeFolder[] = [];
  const seen = new Set<string>();
  for (const { root, entries } of walks) {
    const byDir = new Map<string, Extract<WalkEntry, { kind: "file" }>[]>();
    for (const e of entries) {
      if (e.kind !== "file") continue;
      const dir = dirname(e.path);
      byDir.set(dir, [...(byDir.get(dir) ?? []), e]);
    }
    for (const [dir, files] of byDir) {
      const k = pathKey(dir, platform);
      if (seen.has(k) || rootKeys.has(k) || k === pathKey(root, platform)) continue;
      if (findDecisionKey(config.scope.decisions, dir, platform)) continue;
      if (isSensitiveDir(dir)) continue;
      const shown = files.filter((f) => !isSensitivePath(f.path, []));
      const cands = files.filter((f) => isCandidateFile(f, config.limits, config.privacy.allowPaths));
      if (!cands.length) continue;
      seen.add(k);
      const extCounts: Record<string, number> = {};
      for (const f of shown) extCounts[extOf(f.path)] = (extCounts[extOf(f.path)] ?? 0) + 1;
      // 이름 예시는 민감·비밀 이름이 아니고 본문 검사도 통과한 후보 파일에서만(allowPaths 예외 파일도 이름은 보내지 않는다)
      const samples: SanitizedText[] = [];
      for (const f of [...cands].sort((a, b) => sampleRank(basename(a.path)) - sampleRank(basename(b.path)) || a.path.localeCompare(b.path))) {
        if (samples.length >= SCOPE_SAMPLE_MAX) break;
        if (isSensitivePath(f.path, [])) continue;
        if (opts.nameSafe && !(await opts.nameSafe(f.path))) continue;
        samples.push(sanitize(one(basename(f.path))).text);
      }
      out.push({
        path: dir, key: normalizePath(dir), root,
        relPath: sanitize(one(normalizePath(relative(root, dir)))).text,
        fileCount: shown.length, extCounts, samples,
      });
    }
  }
  return out;
}

/**
 * 본문 검사로 이름 예시 안전성을 판단한다(8.2.1): 추출해 계정 비밀값이 있으면 false, 추출 실패도 false(확인 못 함).
 * 폴더당 예시 최대 5개를 찾을 때까지만 호출되므로 추출 비용은 폴더마다 몇 개로 묶인다.
 */
export function contentNameCheck(extractorFor: (format: Format) => Extractor | null) {
  const cache = new Map<string, boolean>();
  return async (path: string): Promise<boolean> => {
    const hit = cache.get(path);
    if (hit !== undefined) return hit;
    const ex = extractorFor(SUPPORTED_EXT[extname(path).toLowerCase()]);
    let ok = false;
    try {
      const r = ex ? await ex.extract(path) : null;
      ok = !!r?.ok && detectSecret(r.text) === null;
    } catch { ok = false; }
    cache.set(path, ok);
    return ok;
  };
}
