import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { findCandidateFolders } from "../discovery/candidates.js";
import { winFolder as realWinFolder } from "../discovery/defaults.js";
import { pathKey } from "../core/paths.js";

export type FolderSuggestion = {
  path: string; label: string;
  kind: "documents" | "downloads" | "desktop" | "cloud" | "drive" | "keyword";
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
};

const isDir = (p: string) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const list = (p: string) => { try { return readdirSync(p); } catch { return []; } };

async function basics(d: FolderDeps) {
  const home = d.home ?? homedir();
  const platform = d.platform ?? process.platform;
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
  return out;
}

export async function defaultOutputDir(deps: FolderDeps = {}): Promise<string> {
  const { home, exists, docs } = await basics(deps);
  return join(exists(docs) ? docs : home, "MasterPortfolio");
}
