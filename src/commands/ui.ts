import { randomBytes } from "node:crypto";
import { resolveOutputDir } from "../core/paths.js";
import { startUiServer, type SetupDeps } from "../ui/server.js";
import { openBrowser } from "../ui/open.js";
import { renderApp } from "../ui/app.js";
import { PORT_RANGE, loadOrCreateToken, removeServerInfo, writeServerInfo } from "../ui/runtime.js";
import { VERSION } from "../version.js";
import { writeOutputPointer } from "../core/paths.js";
import { defaultOutputDir } from "../setup/folders.js";
import { hasConfig } from "../setup/config.js";

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

/**
 * `mp serve`(11.7): 실행기가 띄우는 백그라운드 화면 서버. 고정 토큰·포트 4317~4327, server.json 기록, 브라우저는 열지 않는다.
 * 결과 폴더가 없으면 설정 모드(기록 파일이 없어도 문서/MasterPortfolio에 결과가 있으면 그대로 이어 씀).
 */
export async function runServe(o: { ports?: number[]; cliPath?: string; setupDeps?: SetupDeps; onReady?: (port: number, close: () => Promise<void>) => void } = {}): Promise<number> {
  let out = await resolveOutputDir();
  if (!out) {
    const def = await defaultOutputDir().catch(() => null);
    if (def && hasConfig(def)) { await writeOutputPointer(def); out = def; }
  }
  const token = loadOrCreateToken();
  let stop: () => void = () => {};
  const stopped = new Promise<void>((ok) => { stop = ok; });
  const srv = await startUiServer({ out, ports: o.ports ?? PORT_RANGE, token, version: VERSION, cliPath: o.cliPath ?? process.argv[1],
    html: (t) => renderApp({ mode: "live", token: t }), setupDeps: o.setupDeps, onShutdown: () => stop() });
  writeServerInfo({ port: srv.port, pid: process.pid, version: VERSION });
  console.log(`[${new Date().toISOString()}] MasterPortfolio ${VERSION} 화면 서버: http://localhost:${srv.port}`);
  const SIGNALS: NodeJS.Signals[] = process.platform === "win32" ? ["SIGINT", "SIGBREAK"] : ["SIGINT", "SIGTERM", "SIGHUP"];
  const onSig = () => stop();
  for (const s of SIGNALS) process.once(s, onSig);
  o.onReady?.(srv.port, async () => stop());
  await stopped;
  for (const s of SIGNALS) process.off(s, onSig);
  removeServerInfo(process.pid);
  await srv.close();
  console.log(`[${new Date().toISOString()}] 화면 서버를 종료했습니다.`);
  return 0;
}
