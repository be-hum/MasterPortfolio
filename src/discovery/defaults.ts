import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const run = promisify(execFile);

async function ps(cmd: string): Promise<string | null> {
  try {
    // PowerShell 5.1은 기본 출력이 시스템 코드 페이지(한국어 Windows는 CP949)라 한글 경로가 깨진다. UTF-8로 받는다
    const { stdout } = await run("powershell", ["-NoProfile", "-NonInteractive", "-Command", `[Console]::OutputEncoding=[Text.Encoding]::UTF8;${cmd}`], { windowsHide: true, timeout: 10_000, encoding: "utf8" });
    return stdout.trim() || null;
  } catch { return null; }
}

async function exists(p: string | null): Promise<boolean> {
  if (!p) return false;
  try { return (await stat(p)).isDirectory(); } catch { return false; }
}

/** Windows의 실제 문서·바탕 화면·다운로드 위치(OneDrive 리디렉션 반영). 실패하면 null */
export async function winFolder(name: "MyDocuments" | "Desktop" | "Downloads"): Promise<string | null> {
  return name === "Downloads"
    ? ps("(New-Object -ComObject Shell.Application).NameSpace('shell:Downloads').Self.Path")
    : ps(`[Environment]::GetFolderPath('${name}')`);
}

export async function defaultFolders(): Promise<string[]> {
  const home = homedir();
  let docs: string | null = join(home, "Documents");
  let downloads: string | null = join(home, "Downloads");
  if (process.platform === "win32") {
    docs = (await winFolder("MyDocuments")) ?? docs;
    downloads = (await winFolder("Downloads")) ?? downloads;
  }
  const out: string[] = [];
  for (const p of [docs, downloads]) if (await exists(p)) out.push(p!);
  return out;
}
