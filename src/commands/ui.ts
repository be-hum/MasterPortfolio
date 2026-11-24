import { randomBytes } from "node:crypto";
import { resolveOutputDir } from "../core/paths.js";
import { startUiServer } from "../ui/server.js";
import { openBrowser } from "../ui/open.js";
import { renderApp } from "../ui/app.js";

export type UiOptions = { port?: number; open?: boolean; cliPath?: string; html?: (token: string) => string };

/** cliPath를 주입하면(테스트) 서버를 열어 둔 채 바로 돌아오고 호출자가 close한다 */
export async function runUi(o: UiOptions = {}): Promise<{ code: number; close?: () => Promise<void>; url?: string }> {
  const out = await resolveOutputDir();
  if (!out) { console.error("먼저 `mp init`을 실행하세요."); return { code: 2 }; }
  const token = randomBytes(32).toString("hex");
  const html = o.html ?? ((t: string) => renderApp({ mode: "live", token: t }));
  let stop: () => void = () => {};
  const stopped = new Promise<void>((ok) => { stop = ok; });
  const srv = await startUiServer({ out, port: o.port, token, cliPath: o.cliPath ?? process.argv[1], html, onShutdown: () => stop() });
  console.log(`MasterPortfolio UI: ${srv.url}`);
  console.log("종료하려면 화면의 [종료] 버튼을 누르거나 이 창에서 Ctrl+C");
  if (o.open !== false && !openBrowser(srv.url)) console.log("브라우저를 열지 못했습니다. 위 주소를 직접 여세요.");
  if (o.cliPath) return { code: 0, close: srv.close, url: srv.url };
  const onSig = () => stop();
  process.once("SIGINT", onSig);
  await stopped;
  process.off("SIGINT", onSig);
  await srv.close();
  console.log("화면 서버를 종료했습니다.");
  return { code: 0 };
}
