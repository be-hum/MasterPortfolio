import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import { isExcludedDirName, resolveEntry } from "./walk.js";
import { folderMatchesKeyword } from "./match.js";
import { isSystemPath } from "./system.js";

export async function findCandidateFolders(
  root: string,
  keywords: string[],
  maxDepth: number,
  opts: { home?: string; platform?: NodeJS.Platform } = {},
): Promise<string[]> {
  const home = opts.home ?? homedir();
  const platform = opts.platform ?? process.platform;
  const found: string[] = [];
  async function visit(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    let ds: Dirent[];
    try { ds = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const d of ds.sort((a, b) => a.name.localeCompare(b.name))) {
      if (d.name.startsWith(".") || isExcludedDirName(d.name, platform) || d.name === "Library") continue;
      const p = join(dir, d.name);
      if (isSystemPath(p, home, platform)) continue;
      if ((await resolveEntry(d, p)).kind !== "dir") continue;
      if (keywords.some((k) => folderMatchesKeyword(d.name, k))) { found.push(p); continue; }
      await visit(p, depth + 1);
    }
  }
  if (isSystemPath(root, home, platform)) return [];
  await visit(root, 1);
  return found.filter((p) => !found.some((q) => q !== p && p.startsWith(q + sep)));
}
