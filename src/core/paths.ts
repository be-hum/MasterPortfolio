import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export function normalizePath(p: string): string {
  let s = p.replace(/\\/g, "/");
  if (/^[a-z]:\//.test(s)) s = s[0].toUpperCase() + s.slice(1);
  return s;
}

/** 경로 비교 키: `/` 구분자, 끝 슬래시 제거, 대소문자 무시 파일시스템(win32·darwin·WSL의 /mnt/<드라이브>)은 소문자. */
export function pathKey(p: string, platform: NodeJS.Platform = process.platform): string {
  let s = normalizePath(p);
  while (s.length > 1 && s.endsWith("/") && !/^[A-Za-z]:\/$/.test(s)) s = s.slice(0, -1);
  const insensitive = platform === "win32" || platform === "darwin" || /^\/mnt\/[a-z](\/|$)/i.test(s);
  return insensitive ? s.toLowerCase() : s;
}

const pointerFile = () => process.env.MP_POINTER_FILE ?? join(homedir(), ".masterportfolio.json");

export async function resolveOutputDir(): Promise<string | null> {
  if (process.env.MP_OUTPUT_DIR) return process.env.MP_OUTPUT_DIR;
  try {
    const j = JSON.parse(await readFile(pointerFile(), "utf8"));
    if (typeof j.outputDir === "string") return j.outputDir;
  } catch { /* 기록 없음 */ }
  // 기록이 없으면 기본 위치(문서\MasterPortfolio)에 결과 폴더가 있는지 본다. 다른 환경(WSL↔Windows)에서 만든 결과 폴더를 찾기 위함
  if (process.env.MP_POINTER_FILE) return null;
  return [join(homedir(), "Documents", "MasterPortfolio"), join(homedir(), "MasterPortfolio")]
    .find((d) => existsSync(join(d, ".mp", "config.json"))) ?? null;
}

/** 이 플랫폼에서 쓸 수 없는 다른 환경의 절대경로인가(Windows에서 /mnt/c/…·/home/…, Linux·macOS에서 C:\… ·\\서버\…) */
export function isForeignPath(p: string, platform: NodeJS.Platform = process.platform): boolean {
  return platform === "win32" ? p.startsWith("/") : /^[A-Za-z]:[\\/]/.test(p) || p.startsWith("\\\\");
}

/** 스캔 폴더가 다른 환경 경로면 안내 문구, 아니면 null. 그대로 스캔하면 모든 파일이 새 파일로 보여 전부 다시 분석되므로 막는다 */
export function foreignConfigMessage(folders: string[], platform: NodeJS.Platform = process.platform): string | null {
  const f = folders.find((p) => isForeignPath(p, platform));
  if (!f) return null;
  const here = platform === "win32" ? "Windows" : "이 환경";
  return `이 결과 폴더의 스캔 설정은 다른 환경에서 만들어졌습니다(예: ${f}). ${here}에서 그대로 스캔하면 모든 파일을 새로 분석하게 되어 막았습니다.\n`
    + "스캔·범위 정리는 설정을 만든 환경(예: WSL)에서 실행하세요. 결과 보기·결정·질의응답·반영·키워드·master는 여기서 할 수 있습니다.";
}

export async function writeOutputPointer(dir: string): Promise<void> {
  if (process.env.MP_OUTPUT_DIR) return;
  await writeFile(pointerFile(), JSON.stringify({ outputDir: dir }, null, 2));
}
