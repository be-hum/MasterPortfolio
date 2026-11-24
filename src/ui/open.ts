import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

function isWsl(): boolean {
  try { return /microsoft/i.test(readFileSync("/proc/version", "utf8")); } catch { return false; }
}

/** 기본 브라우저로 URL을 연다. 실패하면 false(URL만 출력하면 됨) */
export function openBrowser(url: string): boolean {
  let cmd: string, args: string[];
  if (process.platform === "win32") { cmd = "cmd"; args = ["/c", "start", "", url.replace(/&/g, "^&")]; }
  else if (process.platform === "darwin") { cmd = "open"; args = [url]; }
  else if (isWsl()) { cmd = "cmd.exe"; args = ["/c", "start", "", url.replace(/&/g, "^&")]; }
  else { cmd = "xdg-open"; args = [url]; }
  try {
    const c = spawn(cmd, args, { detached: true, stdio: "ignore" });
    c.on("error", () => {});
    c.unref();
    return true;
  } catch { return false; }
}
