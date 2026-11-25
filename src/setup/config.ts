import { mkdir, stat } from "node:fs/promises";
import { defaultConfig, saveConfig } from "../config/config.js";
import { pathKey, writeOutputPointer } from "../core/paths.js";
import { withLocalExecutable } from "../agent/agents.js";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { Config } from "../core/schema.js";

/** 사용자가 입력한 폴더 경로: 앞뒤 공백·감싼 따옴표 제거, 맨 앞 `~` 펼치기, 절대경로로. 빈 입력은 null. */
export function normalizeFolderInput(raw: string, home: string = homedir()): string | null {
  let s = raw.trim();
  if (s.length >= 2 && /^(["']).*\1$/s.test(s)) s = s.slice(1, -1).trim();
  if (!s) return null;
  if (s === "~") s = home;
  else if (/^~[\\/]/.test(s)) s = join(home, s.slice(2));
  return resolve(s);
}

export type SetupInput = { university: string; keywords: string[]; folders: string[]; planScale: number; output: string; agent?: string };
export type SetupValidation = { ok: true; folders: string[]; output: string } | { ok: false; errors: string[] };

export class SetupError extends Error {
  constructor(public errors: string[]) { super(errors.join("\n")); this.name = "SetupError"; }
}

async function isDir(p: string): Promise<boolean | null> {
  try { return (await stat(p)).isDirectory(); } catch { return null; }
}

/** lenient: 스캔 폴더의 존재·개수를 따지지 않는다(`mp init`은 아직 없는 폴더·빈 목록도 허용해 왔다) */
export async function validateSetup(i: SetupInput, opts: { lenient?: boolean } = {}): Promise<SetupValidation> {
  const errors: string[] = [];
  const folders: string[] = [];
  const seen = new Set<string>();
  for (const raw of i.folders) {
    const f = normalizeFolderInput(raw);
    if (!f || seen.has(pathKey(f))) continue;
    seen.add(pathKey(f)); folders.push(f);
    if (!opts.lenient && (await isDir(f)) !== true) errors.push(`폴더를 찾을 수 없습니다: ${f}`);
  }
  if (!folders.length && !opts.lenient) errors.push("스캔할 폴더를 하나 이상 고르세요");
  const output = normalizeFolderInput(i.output ?? "");
  if (!output) errors.push("결과 폴더를 입력하세요");
  else {
    if ((await isDir(output)) === false) errors.push(`결과 폴더가 폴더가 아닙니다: ${output}`);
    if (seen.has(pathKey(output))) errors.push("결과 폴더는 스캔 폴더와 달라야 합니다");
  }
  if (![1, 5, 20].includes(i.planScale)) errors.push("요금제 배수는 1, 5, 20 중 하나여야 합니다");
  return errors.length ? { ok: false, errors } : { ok: true, folders, output: output! };
}

export async function createSetupConfig(i: SetupInput, opts: { lenient?: boolean } = {}): Promise<{ output: string; config: Config }> {
  const v = await validateSetup(i, opts);
  if (!v.ok) throw new SetupError(v.errors);
  await mkdir(v.output, { recursive: true });
  const config = defaultConfig({ university: { input: i.university, keywords: i.keywords }, scanFolders: v.folders, agent: i.agent ?? "claude" });
  config.budget.planScale = i.planScale;
  if (config.agents[config.agent]) config.agents[config.agent] = await withLocalExecutable(config.agent, config.agents[config.agent]);
  await saveConfig(v.output, config);
  await writeOutputPointer(v.output);
  return { output: v.output, config };
}
