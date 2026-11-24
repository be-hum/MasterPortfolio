import { homedir } from "node:os";
import { normalizePath } from "../core/paths.js";

// Windows: drive-relative folders under any drive letter (lowercased for comparison).
const WIN_SYSTEM_DIRS = ["windows", "program files", "program files (x86)", "programdata", "$recycle.bin"];
// macOS: absolute system folders. /Volumes is intentionally not listed here.
const MAC_SYSTEM_DIRS = ["/system", "/library", "/applications", "/private", "/usr", "/bin", "/sbin"];

const within = (p: string, base: string): boolean => p === base || p.startsWith(base + "/");
const lastSegment = (p: string): string => p.replace(/\/+$/, "").split("/").pop() ?? "";

// Same profile as the current home. On Windows a DOS 8.3 short name (e.g. RUNNER~1)
// is accepted for the profile it abbreviates (the temp dir often uses the short form).
function isOwnProfile(name: string, homeName: string, allowShortName: boolean): boolean {
  if (name === homeName) return true;
  const m = /^(.+)~\d+$/.exec(name);
  return allowShortName && m !== null && m[1].length <= 6 && homeName.startsWith(m[1]);
}

/**
 * True when absPath is an OS system folder or another user's profile, or lies beneath one.
 * Windows and macOS only; other platforms return false. Comparison is case-insensitive
 * on win32 and darwin. Other users' profiles include Users/Public, Default and All Users.
 */
export function isSystemPath(
  absPath: string,
  home: string = homedir(),
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform !== "win32" && platform !== "darwin") return false;
  const p = normalizePath(absPath).toLowerCase();
  const homeName = lastSegment(normalizePath(home).toLowerCase());

  if (platform === "win32") {
    const m = /^[a-z]:\/(.*)$/.exec(p);
    if (!m) return false;
    const rest = m[1].replace(/\/+$/, "");
    if (WIN_SYSTEM_DIRS.some((d) => within(rest, d))) return true;
    if (within(rest, "users")) {
      const name = rest.split("/")[1];
      return !!name && !isOwnProfile(name, homeName, true);
    }
    return false;
  }

  const q = p.replace(/\/+$/, "");
  if (MAC_SYSTEM_DIRS.some((d) => within(q, d))) return true;
  if (within(q, "/users")) {
    const name = q.split("/")[2];
    return !!name && (name === "shared" || !isOwnProfile(name, homeName, false));
  }
  return false;
}
