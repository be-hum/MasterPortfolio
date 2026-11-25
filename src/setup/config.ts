import { mkdir, stat } from "node:fs/promises";
import { defaultConfig, loadConfig, saveConfig } from "../config/config.js";
import { isForeignPath, pathKey, writeOutputPointer } from "../core/paths.js";
import { existsSync } from "node:fs";
import { withLocalExecutable } from "../agent/agents.js";
import { homedir } from "node:os";
import { join, posix, resolve, win32 } from "node:path";
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
  /** existing: 고른 결과 폴더에 이미 MasterPortfolio 설정이 있음(덮어쓰지 않음) */
  constructor(public errors: string[], public existing: string | null = null) { super(errors.join("\n")); this.name = "SetupError"; }
}

/** 화면 입력 경로 검사: 전체 경로이고 이 PC의 경로 형식이어야 한다(상대 경로는 프로그램 폴더 기준으로 풀려 엉뚱한 곳이 된다) */
export function pathInputError(raw: string, platform: NodeJS.Platform = process.platform): string | null {
  let s = raw.trim();
  if (s.length >= 2 && /^(["']).*\1$/s.test(s)) s = s.slice(1, -1).trim();
  if (!s || s === "~" || /^~[\\/]/.test(s)) return null;
  if (isForeignPath(s, platform)) return `이 PC에서 쓸 수 없는 경로 형식입니다: ${s}`;
  if (!(platform === "win32" ? win32 : posix).isAbsolute(s)) return `전체 경로를 입력하세요(예: ${platform === "win32" ? "C:\\Users\\이름\\Documents" : "/Users/이름/Documents"}): ${s}`;
  return null;
}

export const hasConfig = (dir: string) => existsSync(join(dir, ".mp", "config.json"));

async function isDir(p: string): Promise<boolean | null> {
  try { return (await stat(p)).isDirectory(); } catch { return null; }
}

/** lenient: 스캔 폴더의 존재·개수를 따지지 않는다(`mp init`은 아직 없는 폴더·빈 목록도 허용해 왔다) */
export async function validateSetup(i: SetupInput, opts: { lenient?: boolean } = {}): Promise<SetupValidation> {
  const errors: string[] = [];
  const folders: string[] = [];
  const seen = new Set<string>();
  for (const raw of i.folders) {
    const bad = opts.lenient ? null : pathInputError(raw);
    if (bad) { errors.push(bad); continue; }
    const f = normalizeFolderInput(raw);
    if (!f || seen.has(pathKey(f))) continue;
    seen.add(pathKey(f)); folders.push(f);
    if (!opts.lenient && (await isDir(f)) !== true) errors.push(`폴더를 찾을 수 없습니다: ${f}`);
  }
  if (!folders.length && !opts.lenient) errors.push("스캔할 폴더를 하나 이상 고르세요");
  const outBad = opts.lenient ? null : pathInputError(i.output ?? "");
  const output = outBad ? null : normalizeFolderInput(i.output ?? "");
  if (outBad) errors.push(outBad);
  else if (!output) errors.push("결과 폴더를 입력하세요");
  else {
    if ((await isDir(output)) === false) errors.push(`결과 폴더가 폴더가 아닙니다: ${output}`);
    if (seen.has(pathKey(output))) errors.push("결과 폴더는 스캔 폴더와 달라야 합니다");
  }
  if (![1, 5, 20].includes(i.planScale)) errors.push("요금제 배수는 1, 5, 20 중 하나여야 합니다");
  return errors.length ? { ok: false, errors } : { ok: true, folders, output: output! };
}

/**
 * adoptExisting: 결과 폴더에 이미 설정이 있으면 그대로 쓰고 기록 파일만 남긴다.
 * 그 밖(화면 설정)에서는 기존 설정을 덮어쓰지 않고 SetupError(existing)로 멈춘다. `mp init`(lenient)은 예전처럼 새로 쓴다.
 */
export async function createSetupConfig(i: SetupInput, opts: { lenient?: boolean; adoptExisting?: boolean } = {}): Promise<{ output: string; config: Config }> {
  if (opts.adoptExisting) {
    const o = normalizeFolderInput(i.output ?? "");
    if (!o || !hasConfig(o)) throw new SetupError(["이 폴더에는 MasterPortfolio 결과가 없습니다"]);
    await writeOutputPointer(o);
    return { output: o, config: await loadConfig(o) };
  }
  const v = await validateSetup(i, opts);
  if (!v.ok) throw new SetupError(v.errors);
  if (!opts.lenient && hasConfig(v.output)) {
    throw new SetupError([`이 폴더에는 이미 MasterPortfolio 결과가 있습니다: ${v.output}. 그대로 쓰거나 다른 폴더를 고르세요.`], v.output);
  }
  await mkdir(v.output, { recursive: true });
  const config = defaultConfig({ university: { input: i.university, keywords: i.keywords }, scanFolders: v.folders, agent: i.agent ?? "claude" });
  config.budget.planScale = i.planScale;
  if (config.agents[config.agent]) config.agents[config.agent] = await withLocalExecutable(config.agent, config.agents[config.agent]);
  await saveConfig(v.output, config);
  await writeOutputPointer(v.output);
  return { output: v.output, config };
}
