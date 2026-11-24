import { describe, it, expect } from "vitest";
import { resolveSpawn } from "../../src/agent/bridge.js";

const NODE = "C:\\Program Files\\nodejs\\node.exe";
const NPX_CLI = "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npx-cli.js";
const yes = () => true;
const no = () => false;
const COMSPEC = process.env.ComSpec ?? "cmd.exe";

describe("resolveSpawn", () => {
  it("passes through on non-Windows", () => {
    expect(resolveSpawn("npx", ["-y", "pkg"], "darwin", "/usr/bin/node", yes))
      .toEqual({ file: "npx", args: ["-y", "pkg"], shell: false, windowsVerbatimArguments: false });
  });

  it("runs npx via node + npx-cli.js on Windows", () => {
    for (const c of ["npx", "npx.cmd", "NPX"]) {
      expect(resolveSpawn(c, ["-y", "@a/b@1.0.0"], "win32", NODE, (p) => p === NPX_CLI))
        .toEqual({ file: NODE, args: [NPX_CLI, "-y", "@a/b@1.0.0"], shell: false, windowsVerbatimArguments: false });
    }
  });

  it("falls back to cmd.exe for npx when npx-cli.js is missing", () => {
    const r = resolveSpawn("npx", ["-y"], "win32", NODE, no);
    expect(r).toEqual({ file: COMSPEC, args: ["/d", "/s", "/c", '"npx ^"-y^""'], shell: false, windowsVerbatimArguments: true });
  });

  it("runs .exe and execPath as-is on Windows", () => {
    expect(resolveSpawn("C:\\tools\\agent.EXE", ["a b"], "win32", NODE, yes))
      .toEqual({ file: "C:\\tools\\agent.EXE", args: ["a b"], shell: false, windowsVerbatimArguments: false });
    expect(resolveSpawn(NODE, ["x.js"], "win32", NODE, yes))
      .toEqual({ file: NODE, args: ["x.js"], shell: false, windowsVerbatimArguments: false });
  });

  it("wraps a bare name in cmd.exe with escaped, quoted args", () => {
    const r = resolveSpawn("agy", ["acp", "a b", "x&y", 'say "hi"', "%PATH%", "dir\\", 'a\\"b'], "win32", NODE, yes);
    expect(r.file).toBe(COMSPEC);
    expect(r.shell).toBe(false);
    expect(r.windowsVerbatimArguments).toBe(true);
    expect(r.args).toEqual(["/d", "/s", "/c",
      '"agy ^"acp^" ^"a^ b^" ^"x^&y^" ^"say^ \\^"hi\\^"^" ^"^%PATH^%^" ^"dir\\\\^" ^"a\\\\\\^"b^""']);
  });

  it("double-escapes metacharacters for .cmd/.bat shims", () => {
    const r = resolveSpawn("C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd", ["x&y", "%PATH%"], "win32", NODE, yes);
    expect(r.args).toEqual(["/d", "/s", "/c",
      '"C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd ^^^"x^^^&y^^^" ^^^"^^^%PATH^^^%^^^""']);
    expect(r.windowsVerbatimArguments).toBe(true);
  });
});
