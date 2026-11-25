import type { Dirent, Stats } from "node:fs";
import { lstat, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { isSystemPath } from "./system.js";
import { pathKey } from "../core/paths.js";
import { scopeResolver, type ScopeDecisions } from "./scopeDecisions.js";

export type WalkEntry =
  | { kind: "file"; path: string; size: number; mtimeMs: number }
  | { kind: "repo"; path: string };

export const EXCLUDED_DIRS = new Set([
  "node_modules", ".git", ".venv", "venv", "__pycache__", ".cache", "dist", "build", "target",
  ".next", ".idea", ".vscode", "AppData", "$RECYCLE.BIN", "System Volume Information", ".Trash",
]);

const EXCLUDED_DIRS_LOWER = new Set([...EXCLUDED_DIRS].map((n) => n.toLowerCase()));

/** 점(.)으로 시작하지 않는 시스템 파일. 대소문자 무시. `~$`로 시작하는 Office 잠금 파일도 제외한다. */
export const EXCLUDED_FILE_NAMES = new Set(["thumbs.db", "desktop.ini"]);

/**
 * 순회에서 건너뛸 이름(파일·폴더 공통): 숨김 항목(`.`으로 시작 — .agents, .claude, .env, .DS_Store 등),
 * EXCLUDED_FILE_NAMES, Office 잠금 파일(`~$*`). 사용자가 직접 지정한 스캔 루트 자체에는 적용하지 않는다.
 */
export function isExcludedFileName(name: string): boolean {
  return name.startsWith(".") || name.startsWith("~$") || EXCLUDED_FILE_NAMES.has(name.toLowerCase());
}

/** Excluded directory name. Case-insensitive on win32 (NTFS), exact elsewhere. */
export function isExcludedDirName(name: string, platform: NodeJS.Platform = process.platform): boolean {
  return platform === "win32" ? EXCLUDED_DIRS_LOWER.has(name.toLowerCase()) : EXCLUDED_DIRS.has(name);
}

/** 생성물·남의 소스로 보이는 폴더 이름(9.7 B). 대소문자 무시. `.rep`로 끝나는 폴더(Ghidra 프로젝트)도 제외. */
export const GENERATED_DIRS = new Set(["out", "tmp", "temp", "logs", "cache", "vendor", "third_party", "site-packages"]);

/**
 * 강의자료(사용자 요청 2026-11-24: "강의자료로 된 부분은 모두 제외, 유사한 단어도").
 * 한국어는 공백·_·- 를 뺀 이름 어디에 있어도, 교안·교재는 앞이 한글이 아닐 때만(비교안 제외).
 * 영어는 폴더 이름이 정확히 일치할 때만(lecture-exam-analyzer 같은 사용자 프로젝트는 남긴다).
 */
const LECTURE_KO = ["강의자료", "강의안", "강의노트", "강의록", "강의슬라이드", "강의교안", "수업자료", "강의녹취"];
const LECTURE_KO_BOUNDED = /(^|[^가-힣])(교안|교재)/;
const LECTURE_DIRS_EXACT = new Set(["lecture", "lectures", "lecturenote", "lecturenotes", "lectureslides", "coursematerial", "coursematerials",
  "classmaterial", "classmaterials", "handout", "handouts", "syllabus", "녹취본"]);
const LECTURE_FILE_EN = [/lecture[\s_-]*\d+/i, /lecture[\s_-]*notes?/i, /^syllabus/i];
const squash = (n: string) => n.toLowerCase().replace(/[\s_-]+/g, "");

export function isLectureName(name: string, kind: "dir" | "file"): boolean {
  const q = squash(name);
  if (LECTURE_KO.some((k) => q.includes(k)) || LECTURE_KO_BOUNDED.test(name)) return true;
  if (kind === "dir") return LECTURE_DIRS_EXACT.has(q);
  return LECTURE_FILE_EN.some((r) => r.test(name));
}

export function isGeneratedDirName(name: string): boolean {
  const n = name.toLowerCase();
  return GENERATED_DIRS.has(n) || (n.endsWith(".rep") && n.length > 4) || isLectureName(name, "dir");
}

/** 라이선스·메타·빌드 파일 이름(9.7 B). 대소문자 무시. */
const GENERATED_FILE_RES = [
  // 이름 자체가 메타 파일이고 확장자만 붙은 경우(LICENSE, CHANGELOG.md, COPYING.txt). licensed-work.md 같은 사용자 파일은 제외하지 않는다.
  /^(license|licence|copying|notice|changelog|authors|contributing|code_of_conduct)(\.(md|txt))?$/i,
  // 라이선스 변형(LICENSE-MIT, LICENSE.APACHE.txt)
  /^licen[cs]e[-_.][a-z0-9.-]+$/i,
  /^security\.md$/i, /^cmakelists\.txt$/i, /^requirements.*\.txt$/i, /^robots\.txt$/i,
];

export function isGeneratedFileName(name: string): boolean {
  return GENERATED_FILE_RES.some((r) => r.test(name)) || isLectureName(name, "file");
}

/** 분할 산출물로 볼 최소 파일 수(도구가 흔히 쓰는 접두어일 때) */
export const SPLIT_OUTPUT_MIN = 10;
/** 접두어와 무관하게 분할 산출물로 볼 최소 파일 수. week1…week15 같은 사용자 과제 묶음은 남긴다. */
export const SPLIT_OUTPUT_MIN_ANY = 50;
/** 도구가 페이지·조각 단위로 쪼갤 때 쓰는 접두어(구분자 제외, 소문자) */
const SPLIT_PREFIXES = new Set(["page", "p", "pg", "chunk", "part", "slide", "seg", "segment", "split", "frame", "img", "image", "ocr", "out", "output", "tmp"]);
const SPLIT_RE = /^(.*?)(\d+)\.(txt|md)$/i;

/**
 * 한 폴더의 파일 이름 중 분할 산출물(9.7 B): `<접두어><숫자>.<txt|md>`(예: page-0053.txt, chunk_12.md) 꼴이
 * 같은 접두어(대소문자 무시)로 SPLIT_OUTPUT_MIN개 이상이면 그 파일들 전부.
 */
export function splitOutputFiles(names: string[]): Set<string> {
  const groups = new Map<string, string[]>();
  for (const n of names) {
    const m = n.match(SPLIT_RE);
    if (!m) continue;
    const k = m[1].toLowerCase();
    groups.set(k, [...(groups.get(k) ?? []), n]);
  }
  const out = new Set<string>();
  for (const [k, g] of groups) {
    const known = SPLIT_PREFIXES.has(k.replace(/[-_. ]+$/, ""));
    if (g.length >= (known ? SPLIT_OUTPUT_MIN : SPLIT_OUTPUT_MIN_ANY)) for (const n of g) out.add(n);
  }
  return out;
}

/** p가 roots 중 하나와 같거나 그 아래에 있으면 true. */
export function isUnderAny(p: string, roots: string[], platform: NodeJS.Platform = process.platform): boolean {
  const k = pathKey(p, platform);
  return roots.some((r) => {
    const rk = pathKey(r, platform);
    return k === rk || k.startsWith(rk.endsWith("/") ? rk : rk + "/");
  });
}

export type ResolvedEntry =
  | { kind: "dir" }
  | { kind: "file"; stat: Stats }
  | { kind: "skip" }
  | { kind: "error" };

/**
 * Classifies a directory entry. Dirent.isSymbolicLink() is true for every Windows reparse
 * point (including OneDrive placeholders), so a flagged entry is confirmed with lstat:
 * only a real symlink/junction is skipped; anything else is classified by lstat.
 */
export async function resolveEntry(d: Dirent, p: string): Promise<ResolvedEntry> {
  try {
    if (d.isSymbolicLink()) {
      const st = await lstat(p);
      if (st.isSymbolicLink()) return { kind: "skip" };
      if (st.isDirectory()) return { kind: "dir" };
      if (st.isFile()) return { kind: "file", stat: st };
      return { kind: "skip" };
    }
    if (d.isDirectory()) return { kind: "dir" };
    if (d.isFile()) return { kind: "file", stat: await lstat(p) };
    return { kind: "skip" };
  } catch {
    return { kind: "error" };
  }
}

export type WalkOptions = {
  home?: string; platform?: NodeJS.Platform; excludeRoots?: string[];
  /** 폴더 범위 판단(5.5): 가장 가까운 상위(자기 포함) 판단이 exclude인 폴더는 내려가지 않는다(하위 include 쪽으로만 내려감). */
  scope?: ScopeDecisions;
};

export async function walk(root: string, opts: WalkOptions = {}) {
  const home = opts.home ?? homedir();
  const platform = opts.platform ?? process.platform;
  const exclude = opts.excludeRoots ?? [];
  const excluded = (p: string) => exclude.length > 0 && isUnderAny(p, exclude, platform);
  const entries: WalkEntry[] = [];
  const inaccessible: string[] = [];
  /** 생성물로 보여 제외한 폴더·파일(9.7 B). 폴더는 안을 보지 않으므로 폴더 하나로 센다. */
  const generated: string[] = [];
  if (isSystemPath(root, home, platform) || excluded(root)) return { entries, inaccessible, generated };
  const scope = opts.scope && Object.keys(opts.scope).length ? scopeResolver(opts.scope, platform) : null;

  async function visit(dir: string): Promise<void> {
    // exclude 판단 폴더: 하위에 include 판단이 없으면 읽지도 않고, 있으면 하위 폴더로만 내려간다(파일·저장소는 버림)
    const scopeExcluded = scope?.decisionFor(dir) === "exclude";
    if (scopeExcluded && !scope!.includeBelow(dir)) return;
    let names: Dirent[];
    try { names = await readdir(dir, { withFileTypes: true }); }
    catch { inaccessible.push(dir); return; }
    // MasterPortfolio 결과 폴더(현재 것이 아니어도: 옮긴 백업·다른 결과 폴더)는 우리가 만든 카드라 다시 분석하지 않는다
    if (names.some((d) => d.name === ".mp") && (await isFile(join(dir, ".mp", "config.json")))) { generated.push(dir); return; }
    if (!scopeExcluded && names.some((d) => d.name === ".git")) { entries.push({ kind: "repo", path: dir }); return; }
    names.sort((a, b) => a.name.localeCompare(b.name));
    const split = splitOutputFiles(names.filter((d) => !d.isDirectory() && !isExcludedFileName(d.name)).map((d) => d.name));
    for (const d of names) {
      // 숨김 폴더 안으로는 들어가지 않는다(.git 포함 폴더는 위에서 저장소 하나로 처리됨)
      if (isExcludedFileName(d.name)) continue;
      const p = join(dir, d.name);
      if (isSystemPath(p, home, platform) || excluded(p)) continue;
      const r = await resolveEntry(d, p);
      if (r.kind === "dir") {
        if (isExcludedDirName(d.name, platform)) continue;
        if (d.name === "Library" && dir === home) continue;
        if (isGeneratedDirName(d.name)) { if (!scopeExcluded) generated.push(p); continue; }
        await visit(p);
      } else if (r.kind === "file") {
        if (scopeExcluded) continue;
        if (isGeneratedFileName(d.name) || split.has(d.name)) { generated.push(p); continue; }
        entries.push({ kind: "file", path: p, size: r.stat.size, mtimeMs: r.stat.mtimeMs });
      } else if (r.kind === "error") {
        if (!scopeExcluded) inaccessible.push(p);
      }
    }
  }
  await visit(root);
  return { entries, inaccessible, generated };
}

const isFile = (p: string) => stat(p).then((s) => s.isFile(), () => false);
