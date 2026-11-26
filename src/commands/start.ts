import { launch, loadOrCreateToken, spawnServeProcess, type LaunchDeps } from "../ui/runtime.js";
import { openBrowser } from "../ui/open.js";
import { VERSION } from "../version.js";

/**
 * 더블클릭 실행 진입점(`mp start`, 11.7): 화면 서버를 뒤에서 띄우고(이미 실행 중이면 그대로) 브라우저로 연 뒤 바로 끝난다.
 * 처음 설정·결과 폴더 찾기는 서버(`mp serve`)가 한다. 주소: http://localhost:4317(사용 중이면 4318~)
 */
export async function runStart(deps: Partial<LaunchDeps> = {}): Promise<number> {
  console.log("MasterPortfolio를 시작합니다…");
  const r = await launch({
    version: VERSION, token: deps.token ?? loadOrCreateToken(),
    spawnServer: deps.spawnServer ?? (() => spawnServeProcess(process.argv[1])),
    // MP_NO_BROWSER=1: 브라우저를 열지 않음(시험·원격 실행용)
    openBrowser: deps.openBrowser ?? (process.env.MP_NO_BROWSER === "1" ? (u: string) => { console.log(`주소: ${u.replace(/\?t=.*/, "")}`); return true; } : openBrowser),
    ...deps,
  });
  if (r.code === 0) console.log("브라우저에서 열었습니다. 이 창은 닫혀도 됩니다(화면의 [종료]로 끝냅니다).");
  return r.code;
}
