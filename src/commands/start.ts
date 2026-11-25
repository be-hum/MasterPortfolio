import { resolveOutputDir, writeOutputPointer } from "../core/paths.js";
import { defaultOutputDir } from "../setup/folders.js";
import { hasConfig } from "../setup/config.js";
import { runUi } from "./ui.js";

/**
 * 더블클릭 실행 진입점(`mp start`, Windows 실행 파일이 부른다).
 * 결과 폴더가 없으면 처음 설정을 브라우저 화면에서 하고, 있으면 바로 화면을 연다.
 * 스캔·묶기·반영은 화면의 작업 바에서 한다.
 */
export async function runStart(deps: { ui?: typeof runUi; defaultOutput?: () => Promise<string> } = {}): Promise<number> {
  console.log("MasterPortfolio — 흩어진 자료에서 이력서·포트폴리오 경험을 찾아 정리합니다.\n");
  let first = !(await resolveOutputDir());
  if (first) {
    // 기록 파일이 없어도 실제 문서 위치(OneDrive로 옮겨진 문서 포함)에 결과가 있으면 그대로 이어 쓴다
    const def = await (deps.defaultOutput ?? defaultOutputDir)().catch(() => null);
    if (def && hasConfig(def)) { await writeOutputPointer(def); first = false; console.log(`기존 결과 폴더를 찾았습니다: ${def}`); }
  }
  if (first) console.log("처음 설정 화면을 브라우저에서 엽니다.");
  return (await (deps.ui ?? runUi)(first ? { setup: true } : {})).code;
}
