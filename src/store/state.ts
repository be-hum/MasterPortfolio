import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { State } from "../core/schema.js";

const p = (d: string) => join(d, ".mp", "state.json");
export const CORRUPT_STATE_MSG = "state.json 손상 — `mp scan`으로 먼저 정합성 검사 후 다시 실행";
export const emptyState = (): State => ({ schema_version: 1, files: {}, experiences: {}, last_scan: null });

export async function loadState(outputDir: string): Promise<{ state: State; problem: "missing" | "corrupt" | null }> {
  let raw: string;
  try { raw = await readFile(p(outputDir), "utf8"); } catch { return { state: emptyState(), problem: "missing" }; }
  try { return { state: State.parse(JSON.parse(raw)), problem: null }; }
  catch { return { state: emptyState(), problem: "corrupt" }; }
}

export async function saveState(outputDir: string, s: State): Promise<void> {
  await mkdir(join(outputDir, ".mp"), { recursive: true });
  const tmp = p(outputDir) + ".tmp";
  await writeFile(tmp, JSON.stringify(State.parse(s), null, 2));
  await rename(tmp, p(outputDir));
}
