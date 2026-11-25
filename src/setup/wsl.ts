import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { win32 } from "node:path";

/** `wsl.exe -l -q` 출력(UTF-16LE, 끝에 NUL·BOM이 섞일 수 있음)을 배포판 이름 목록으로. Docker Desktop 내부 배포판은 뺀다 */
export function parseWslList(out: Buffer | string): string[] {
  const text = typeof out === "string" ? out : out.includes(0) ? out.toString("utf16le") : out.toString("utf8");
  return text.replace(/^﻿/, "").replace(/\0/g, "").split(/\r?\n/).map((s) => s.trim())
    .filter((s) => s && !/^docker-desktop/i.test(s));
}

/** 설치된 WSL 배포판 이름. WSL이 없거나 응답이 없으면 빈 목록 */
export function listWslDistros(timeoutMs = 5000): Promise<string[]> {
  return new Promise((ok) => {
    execFile("wsl.exe", ["-l", "-q"], { windowsHide: true, timeout: timeoutMs, encoding: "buffer" }, (err, stdout) => {
      ok(err ? [] : parseWslList(stdout));
    });
  });
}

/** 배포판의 사용자 홈 폴더(\\wsl.localhost\<배포판>\home\<사용자>). 처음 접근하면 꺼져 있던 배포판이 켜질 수 있다 */
export async function wslHomes(listDistros: () => Promise<string[]> = listWslDistros, list: (p: string) => Promise<string[]> = (p) => readdir(p)): Promise<{ distro: string; home: string }[]> {
  const out: { distro: string; home: string }[] = [];
  for (const distro of await listDistros()) {
    const base = win32.join(`\\\\wsl.localhost\\${distro}`, "home");
    let users: string[] = [];
    try { users = await list(base); } catch { continue; }
    for (const u of users.sort()) out.push({ distro, home: win32.join(base, u) });
  }
  return out;
}
