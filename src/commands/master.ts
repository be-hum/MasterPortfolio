import { writeFileAtomic } from "../core/atomicWrite.js";
import { progress } from "../core/progress.js";
import { join } from "node:path";
import { resolveOutputDir } from "../core/paths.js";
import { adoptedOnly, buildUiState, loadFileTitles } from "../ui/model.js";
import { renderApp } from "../ui/app.js";
import { listExperiences } from "../store/experiences.js";
import { loadState } from "../store/state.js";
import { renderMaster } from "../store/masterMd.js";
import { isoNow } from "../store/cards.js";

/** master.md·master.html을 지금 경험 카드로 다시 쓴다(로컬, Claude 사용 없음). 채택 경험 수 */
export async function writeMasterFiles(out: string): Promise<{ count: number; path: string; htmlPath: string }> {
  const { state, problem } = await loadState(out);
  if (problem === "corrupt") throw new Error("state.json 손상");
  const exps = await listExperiences(out, state);
  const titles = await loadFileTitles(out, exps);
  const path = join(out, "master.md");
  await writeFileAtomic(path, renderMaster(exps, titles));
  const htmlPath = join(out, "master.html");
  await writeFileAtomic(htmlPath, renderApp({ mode: "static", data: adoptedOnly(buildUiState(exps, titles)), generatedAt: isoNow().slice(0, 16).replace("T", " ") }));
  return { count: exps.filter((e) => e.fm.review === "adopted").length, path, htmlPath };
}

/**
 * 경험 카드를 바꾸는 명령(group·review·keywords)과 화면 수정 뒤에 부른다: master가 늘 최신이도록.
 * 실패해도 원래 작업은 성공으로 둔다(로그만).
 */
export async function refreshMaster(out?: string | null): Promise<void> {
  const dir = out ?? (await resolveOutputDir());
  if (!dir) return;
  try { await writeMasterFiles(dir); } catch (e) { console.error(`master 자동 갱신 실패: ${e instanceof Error ? e.message : String(e)}`); }
}

export async function runMaster(): Promise<{ code: number; count: number; path: string | null; htmlPath: string | null }> {
  const out = await resolveOutputDir();
  if (!out) { console.error("먼저 `mp init`을 실행하세요."); return { code: 2, count: 0, path: null, htmlPath: null }; }
  const { count, path, htmlPath } = await writeMasterFiles(out);
  console.log(`master.md·master.html을 만들었습니다(채택 경험 ${count}개):\n- ${path}\n- ${htmlPath} (브라우저로 열기)`);
  progress.summary(`채택 경험 ${count}개로 master.md·master.html을 만들었습니다`);
  return { code: 0, count, path, htmlPath };
}
