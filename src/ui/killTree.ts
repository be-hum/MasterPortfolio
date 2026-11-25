import { spawn, type ChildProcess } from "node:child_process";

/**
 * 작업 프로세스와 그 아래 프로세스(npx → 에이전트 어댑터 → claude)를 함께 끝낸다.
 * child.kill()만 하면 CLI만 죽고 에이전트가 남아 사용량을 계속 쓸 수 있다.
 * - Windows: taskkill /T /F (프로세스 트리)
 * - 그 밖: detached로 띄운 프로세스 그룹 전체에 SIGTERM, 2초 뒤 남아 있으면 SIGKILL
 */
export function killTree(child: ChildProcess, platform: NodeJS.Platform = process.platform): void {
  const pid = child.pid;
  if (pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  if (platform === "win32") {
    try {
      const k = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      k.on("error", () => { try { child.kill(); } catch { /* 이미 끝남 */ } });
    } catch { try { child.kill(); } catch { /* 이미 끝남 */ } }
    return;
  }
  const group = (sig: NodeJS.Signals) => { try { process.kill(-pid, sig); } catch { try { child.kill(sig); } catch { /* 이미 끝남 */ } } };
  group("SIGTERM");
  const t = setTimeout(() => group("SIGKILL"), 2000);
  t.unref();
}

/** killTree가 그룹 전체를 끝낼 수 있게 POSIX에서는 새 프로세스 그룹으로 띄운다 */
export const spawnGroupOptions = (platform: NodeJS.Platform = process.platform) => ({ detached: platform !== "win32" });
