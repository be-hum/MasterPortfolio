import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const run = promisify(execFile);

async function ps(cmd: string): Promise<string | null> {
  try {
    const { stdout } = await run("powershell", ["-NoProfile", "-NonInteractive", "-Command", cmd], { windowsHide: true, timeout: 10_000 });
    return stdout.trim() || null;
  } catch { return null; }
}

async function exists(p: string | null): Promise<boolean> {
  if (!p) return false;
  try { return (await stat(p)).isDirectory(); } catch { return false; }
}

export async function defaultFolders(): Promise<string[]> {
  const home = homedir();
  let docs: string | null = join(home, "Documents");
  let downloads: string | null = join(home, "Downloads");
  if (process.platform === "win32") {
    docs = (await ps("[Environment]::GetFolderPath('MyDocuments')")) ?? docs;
    downloads = (await ps("(New-Object -ComObject Shell.Application).NameSpace('shell:Downloads').Self.Path")) ?? downloads;
  }
  const out: string[] = [];
  for (const p of [docs, downloads]) if (await exists(p)) out.push(p!);
  return out;
}
