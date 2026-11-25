import { describe, expect, it } from "vitest";
import { pickFolder, PickUnavailable, type Runner } from "../../src/setup/pickFolder.js";

describe("pickFolder", () => {
  it("win32 returns trimmed path, passes user strings via env only", async () => {
    const calls: Parameters<Runner>[] = [];
    const run: Runner = async (...a) => { calls.push(a); return { code: 0, stdout: "C:\\x\\y\r\n" }; };
    expect(await pickFolder({ platform: "win32", isWsl: false, initial: "C:\\evil'; calc", title: "T", run })).toBe("C:\\x\\y");
    expect(calls[0][0]).toBe("powershell.exe");
    expect(calls[0][2].MP_PICK_INITIAL).toBe("C:\\evil'; calc");
    expect(calls[0][1].join(" ")).not.toContain("evil");
    expect(await pickFolder({ platform: "win32", isWsl: false, run: async () => ({ code: 0, stdout: "" }) })).toBeNull();
  });
  it("WSL converts via wslpath", async () => {
    const run: Runner = async (f, a) => f === "wslpath" && a[0] === "-u" ? { code: 0, stdout: "/mnt/c/x\n" } : { code: 0, stdout: "C:\\x" };
    expect(await pickFolder({ platform: "linux", isWsl: true, run })).toBe("/mnt/c/x");
  });
  it("darwin cancel is null", async () => {
    expect(await pickFolder({ platform: "darwin", run: async (_f, a) => a[1]?.includes("choose folder") ? { code: 1, stdout: "" } : { code: 0, stdout: "" } })).toBeNull();
  });
  it("linux without zenity is PickUnavailable", async () => {
    const run: Runner = async () => { throw Object.assign(new Error("x"), { code: "ENOENT" }); };
    await expect(pickFolder({ platform: "linux", isWsl: false, run })).rejects.toBeInstanceOf(PickUnavailable);
  });
});
