import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";

/** 대상 플랫폼의 경로 규칙(테스트에서 플랫폼을 주입해도 실행 OS와 무관하게 같은 결과) */
const pathFor = (platform: NodeJS.Platform) => (platform === "win32" ? win32 : posix);
import { findCandidateFolders } from "../discovery/candidates.js";
import { winFolder as realWinFolder } from "../discovery/defaults.js";
import { pathKey } from "../core/paths.js";
import { wslHomes as realWslHomes } from "./wsl.js";

/** WSL 홈 안에서 자료가 있을 만한 폴더 이름(홈 자체는 넣지 않는다) */
export const WSL_KEYWORDS = ["projects", "project", "portfolio", "workspace", "repos", "dev", "프로젝트", "포트폴리오", "과제"];
/** WSL 검색 상한(처음 접근 때 배포판이 켜지고 9P 파일 시스템이 느리다) */
const WSL_TIMEOUT_MS = 15_000;

export type FolderSuggestion = {
  path: string; label: string;
  kind: "documents" | "downloads" | "desktop" | "cloud" | "drive" | "keyword" | "wsl";
  checked: boolean;
};

export type FolderDeps = {
  home?: string; platform?: NodeJS.Platform;
  exists?: (p: string) => boolean;
  listDir?: (p: string) => string[];
  winFolder?: (name: "MyDocuments" | "Desktop" | "Downloads") => Promise<string | null>;
  /** 심볼릭 링크를 풀어 실제 경로를 돌려준다(macOS /Volumes 의 "/" 링크 제외용) */
  realpath?: (p: string) => string;
  systemDrive?: string;
  candidates?: (root: string, keywords: string[]) => Promise<string[]>;
  /** Windows에서 WSL 배포판의 사용자 홈 목록 */
  wslHomes?: () => Promise<{ distro: string; home: string }[]>;
  /** WSL 홈 안 폴더 찾기(테스트 주입용). 기본: 깊이 2까지 이름 검색 */
  wslCandidates?: (home: string, keywords: string[]) => Promise<string[]>;
  wslTimeoutMs?: number;
};

const isDir = (p: string) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const list = (p: string) => { try { return readdirSync(p); } catch { return []; } };

async function basics(d: FolderDeps) {
  const home = d.home ?? homedir();
  const platform = d.platform ?? process.platform;
  const join = pathFor(platform).join;
  const exists = d.exists ?? isDir;
  const win = d.winFolder ?? realWinFolder;
  const pick = async (n: "MyDocuments" | "Desktop" | "Downloads", fallback: string) =>
    (platform === "win32" ? await win(n) : null) ?? join(home, fallback);
  return {
    home, platform, exists,
    docs: await pick("MyDocuments", "Documents"),
    downloads: await pick("Downloads", "Downloads"),
    desktop: await pick("Desktop", "Desktop"),
  };
}

export async function suggestFolders(keywords: string[], deps: FolderDeps = {}): Promise<FolderSuggestion[]> {
  const { home, platform, exists, docs, downloads, desktop } = await basics(deps);
  const join = pathFor(platform).join;
  const listDir = deps.listDir ?? list;
  const out: FolderSuggestion[] = [];
  const key = (p: string) => pathKey(p, platform);
  const under = (p: string, root: string) => { const k = key(p), r = key(root); return k === r || k.startsWith(r.endsWith("/") ? r : r + "/"); };
  const add = (path: string, label: string, kind: FolderSuggestion["kind"], checked: boolean): boolean => {
    if (out.some((o) => key(o.path) === key(path))) return false;
    out.push({ path, label, kind, checked }); return true;
  };
  for (const [p, label, kind] of [[docs, "문서", "documents"], [downloads, "다운로드", "downloads"], [desktop, "바탕 화면", "desktop"]] as const) {
    if (exists(p)) add(p, label, kind, true);
  }
  const basic = out.map((o) => o.path);
  const cloud: string[] = [];
  for (const n of listDir(home).filter((n) => n.startsWith("OneDrive")).sort()) cloud.push(join(home, n));
  if (platform === "darwin") {
    const cs = join(home, "Library", "CloudStorage");
    for (const n of listDir(cs).sort()) cloud.push(join(cs, n));
  }
  for (const p of cloud) {
    if (!exists(p) || basic.some((b) => under(b, p))) continue;
    const name = p.split(/[\\/]/).pop()!;
    add(p, `클라우드: ${name}`, "cloud", false);
  }
  if (platform === "win32") {
    const sys = (deps.systemDrive ?? process.env.SystemDrive ?? "C:").toUpperCase().replace(/[\\/]+$/, "");
    for (let c = 67; c <= 90; c++) {
      const letter = String.fromCharCode(c);
      if (`${letter}:` === sys) continue;
      const p = `${letter}:\\`;
      if (exists(p)) add(p, `드라이브 ${letter}:`, "drive", false);
    }
  } else if (platform === "darwin") {
    for (const n of listDir("/Volumes").sort()) {
      const p = join("/Volumes", n);
      let real = p;
      try { real = (deps.realpath ?? realpathSync)(p); } catch { /* 링크가 아니거나 읽을 수 없음 */ }
      if (real === "/" || !exists(p)) continue;
      add(p, `드라이브 ${n}`, "drive", false);
    }
  }
  const above = out.map((o) => o.path);
  const find = deps.candidates ?? ((root, kw) => findCandidateFolders(root, kw, 4, { home, platform }));
  for (const p of await find(home, ["project", "projects", "프로젝트", ...keywords])) {
    if (above.some((a) => under(p, a))) continue;
    add(p, p.split(/[\\/]/).filter(Boolean).pop() ?? p, "keyword", false);
  }
  if (platform === "win32") for (const w of await wslSuggestions(keywords, deps)) add(w.path, w.label, "wsl", true);
  return out;
}

/**
 * WSL이 있으면 각 배포판의 사용자 홈 안에서 자료가 있을 만한 폴더(projects·portfolio 등, 깊이 2)를 찾는다.
 * 홈 전체는 넣지 않는다. 찾은 폴더는 기본 체크(화면에서 알리고 끌 수 있음). 시간이 오래 걸리면 건너뛴다.
 */
async function wslSuggestions(keywords: string[], deps: FolderDeps): Promise<{ path: string; label: string }[]> {
  const homes = deps.wslHomes ?? (() => realWslHomes());
  const find = deps.wslCandidates ?? ((h, kw) => findCandidateFolders(h, kw, 2, { home: h, platform: "win32" }));
  const work = (async () => {
    const res: { path: string; label: string }[] = [];
    for (const { distro, home } of await homes()) {
      for (const p of await find(home, [...WSL_KEYWORDS, ...keywords]).catch(() => [])) {
        if (pathKey(p, "win32") === pathKey(home, "win32")) continue;
        // 같은 이름(projects)이 여럿일 수 있어 홈 기준 경로로 보인다: ~/kiro/projects
        const rel = win32.relative(home, p).split(/[\\/]/).filter(Boolean).join("/");
        res.push({ path: p, label: `WSL(${distro}): ~/${rel}` });
      }
    }
    return res;
  })().catch(() => []);
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<{ path: string; label: string }[]>((ok) => { timer = setTimeout(() => ok([]), deps.wslTimeoutMs ?? WSL_TIMEOUT_MS); });
  try { return await Promise.race([work, timeout]); } finally { clearTimeout(timer); }
}

export async function defaultOutputDir(deps: FolderDeps = {}): Promise<string> {
  const { home, platform, exists, docs } = await basics(deps);
  return pathFor(platform).join(exists(docs) ? docs : home, "MasterPortfolio");
}
