import { randomBytes } from "node:crypto";
import { resolveOutputDir } from "../core/paths.js";
import { startUiServer, type SetupDeps } from "../ui/server.js";
import { openBrowser } from "../ui/open.js";
import { renderApp } from "../ui/app.js";

export type UiOptions = { port?: number; open?: boolean; cliPath?: string; setup?: boolean; setupDeps?: SetupDeps; html?: (token: string) => string };

/** cliPath를 주입하면(테스트) 서버를 열어 둔 채 바로 돌아오고 호출자가 close한다 */
export async function runUi(o: UiOptions = {}): Promise<{ code: number; close?: () => Promise<void>; url?: string }> {
  const out = await resolveOutputDir();
  if (!out && !o.setup) { console.error("먼저 `mp init`을 실행하세요."); return { code: 2 }; }
  const token = randomBytes(32).toString("hex");
  const html = o.html ?? ((t: string) => renderApp({ mode: "live", token: t }));
  let stop: () => void = () => {};
  const stopped = new Promise<void>((ok) => { stop = ok; });
  const srv = await startUiServer({ out, port: o.port, token, cliPath: o.cliPath ?? process.argv[1], html, setupDeps: o.setupDeps, onShutdown: () => stop() });
  console.log(`MasterPortfolio UI: ${srv.url}`);
  console.log("종료하려면 화면의 [종료] 버튼을 누르거나 이 창에서 Ctrl+C");
  if (o.open !== false && !openBrowser(srv.url)) console.log("브라우저를 열지 못했습니다. 위 주소를 직접 여세요.");
  if (o.cliPath) return { code: 0, close: srv.close, url: srv.url };
  // 창을 닫거나(SIGHUP) Ctrl+C·종료 신호를 받으면 실행 중인 작업과 에이전트도 함께 끝낸다(작업은 별도 프로세스 그룹이라 신호가 직접 가지 않는다)
  const onSig = () => stop();
  const SIGNALS: NodeJS.Signals[] = process.platform === "win32" ? ["SIGINT", "SIGBREAK"] : ["SIGINT", "SIGTERM", "SIGHUP"];
  for (const s of SIGNALS) process.once(s, onSig);
  await stopped;
  for (const s of SIGNALS) process.off(s, onSig);
  await srv.close();
  console.log("화면 서버를 종료했습니다.");
  return { code: 0 };
}
