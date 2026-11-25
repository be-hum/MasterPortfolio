import { execFile } from "node:child_process";

export type Runner = (file: string, args: string[], env: NodeJS.ProcessEnv) => Promise<{ code: number; stdout: string }>;

export class PickUnavailable extends Error {
  constructor(message = "폴더 선택 창을 열 수 없습니다. 경로를 직접 입력하세요") { super(message); this.name = "PickUnavailable"; }
}

const defaultRun: Runner = (file, args, env) => new Promise((resolve, reject) => {
  execFile(file, args, { env, windowsHide: false, encoding: "utf8", maxBuffer: 1 << 20 }, (err, stdout) => {
    if (!err) return resolve({ code: 0, stdout });
    const code = (err as NodeJS.ErrnoException & { code?: unknown }).code;
    if (typeof code === "number") return resolve({ code, stdout: stdout ?? "" });
    reject(err);
  });
});

/** 사용자 문자열은 스크립트 본문에 넣지 않고 환경 변수(MP_PICK_INITIAL, MP_PICK_TITLE)로만 넘긴다 */
const PS_SCRIPT = [
  "[Console]::OutputEncoding=[Text.Encoding]::UTF8",
  "Add-Type -AssemblyName System.Windows.Forms",
  "$o=New-Object System.Windows.Forms.Form",
  "$o.TopMost=$true",
  "$d=New-Object System.Windows.Forms.FolderBrowserDialog",
  "$d.Description=$env:MP_PICK_TITLE",
  "if($env:MP_PICK_INITIAL){$d.SelectedPath=$env:MP_PICK_INITIAL}",
  "if($d.ShowDialog($o) -eq [System.Windows.Forms.DialogResult]::OK){[Console]::Out.Write($d.SelectedPath)}",
].join(";");

const OSA_SCRIPT = 'POSIX path of (choose folder with prompt (system attribute "MP_PICK_TITLE"))';
const OSA_ACTIVATE = 'tell application "System Events" to activate';

export function isWsl(): boolean {
  return process.platform === "linux" && (Boolean(process.env.WSL_DISTRO_NAME) || Boolean(process.env.WSL_INTEROP));
}

export async function pickFolder(opts: { initial?: string; title?: string; platform?: NodeJS.Platform; isWsl?: boolean; run?: Runner } = {}): Promise<string | null> {
  const platform = opts.platform ?? process.platform;
  const wsl = opts.isWsl ?? isWsl();
  const run = opts.run ?? defaultRun;
  const title = opts.title ?? "스캔할 폴더를 고르세요";
  const env = { ...process.env, MP_PICK_TITLE: title, MP_PICK_INITIAL: opts.initial ?? "" };
  const unavailable = () => new PickUnavailable();
  const clean = (s: string) => s.replace(/^﻿/, "").trim();
  try {
    if (platform === "win32" || wsl) {
      let initial = opts.initial ?? "";
      if (wsl && initial) {
        try { const r = await run("wslpath", ["-w", initial], env); if (r.code === 0 && clean(r.stdout)) initial = clean(r.stdout); } catch { /* 원래 값 */ }
      }
      const r = await run("powershell.exe", ["-NoProfile", "-STA", "-Command", PS_SCRIPT], { ...env, MP_PICK_INITIAL: initial });
      if (r.code !== 0) throw unavailable();
      const p = clean(r.stdout);
      if (!p) return null;
      if (!wsl) return p;
      const w = await run("wslpath", ["-u", p], env);
      if (w.code !== 0 || !clean(w.stdout)) throw unavailable();
      return clean(w.stdout);
    }
    if (platform === "darwin") {
      try { await run("osascript", ["-e", OSA_ACTIVATE], env); } catch { /* 앞으로 가져오기 실패는 무시 */ }
      const r = await run("osascript", ["-e", OSA_SCRIPT], env);
      if (r.code === 1) return null;
      if (r.code !== 0) throw unavailable();
      return clean(r.stdout).replace(/(.)\/$/, "$1") || null;
    }
    const r = await run("zenity", ["--file-selection", "--directory", "--title=스캔할 폴더를 고르세요"], env);
    if (r.code === 1) return null;
    if (r.code !== 0) throw unavailable();
    return clean(r.stdout) || null;
  } catch (e) {
    if (e instanceof PickUnavailable) throw e;
    throw unavailable();
  }
}
