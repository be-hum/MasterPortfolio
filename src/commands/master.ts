import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveOutputDir } from "../core/paths.js";
import { adoptedOnly, buildUiState, loadFileTitles } from "../ui/model.js";
import { renderApp } from "../ui/app.js";
import { listExperiences } from "../store/experiences.js";
import { loadState } from "../store/state.js";
import { renderMaster } from "../store/masterMd.js";
import { isoNow } from "../store/cards.js";

export async function runMaster(): Promise<{ code: number; count: number; path: string | null; htmlPath: string | null }> {
  const out = await resolveOutputDir();
  if (!out) { console.error("먼저 `mp init`을 실행하세요."); return { code: 2, count: 0, path: null, htmlPath: null }; }
  const { state } = await loadState(out);
  const exps = await listExperiences(out, state);
  const titles = await loadFileTitles(out, exps);
  const path = join(out, "master.md");
  await writeFile(path, renderMaster(exps, titles));
  const htmlPath = join(out, "master.html");
  await writeFile(htmlPath, renderApp({ mode: "static", data: adoptedOnly(buildUiState(exps, titles)), generatedAt: isoNow().slice(0, 16).replace("T", " ") }));
  const count = exps.filter((e) => e.fm.review === "adopted").length;
  console.log(`master.md·master.html을 만들었습니다(채택 경험 ${count}개):\n- ${path}\n- ${htmlPath} (브라우저로 열기)`);
  return { code: 0, count, path, htmlPath };
}
