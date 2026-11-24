import { resolveOutputDir } from "../core/paths.js";
import { runInit } from "./init.js";
import { runUi } from "./ui.js";

/**
 * 더블클릭 실행 진입점(`mp start`, Windows 실행 파일이 부른다).
 * 결과 폴더가 없으면 처음 설정(mp init)을 터미널에서 하고, 그다음 브라우저 화면(mp ui)을 연다.
 * 스캔·묶기·반영은 화면의 작업 바에서 한다.
 */
export async function runStart(deps: { init?: typeof runInit; ui?: typeof runUi } = {}): Promise<number> {
  console.log("MasterPortfolio — 흩어진 자료에서 이력서·포트폴리오 경험을 찾아 정리합니다.\n");
  if (!(await resolveOutputDir())) {
    console.log("처음 실행입니다. 대학명, 자료를 찾을 폴더, 결과를 둘 폴더를 차례로 정합니다.");
    console.log("분석에는 이 PC에 설치·로그인된 Claude Code(구독)를 사용합니다.\n");
    const code = await (deps.init ?? runInit)({});
    if (code !== 0) { console.error("\n처음 설정을 마치지 못했습니다. 다시 실행해 주세요."); return code; }
    if (!(await resolveOutputDir())) { console.error("결과 폴더를 찾지 못했습니다."); return 2; }
    console.log("\n설정을 마쳤습니다. 화면에서 [새 자료 스캔] → [경험 묶기] 순서로 진행하세요.\n");
  }
  return (await (deps.ui ?? runUi)({})).code;
}
