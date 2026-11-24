import { describe, it, expect, afterEach } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { mkTmp } from "../helpers/tmp.js";
import { foreignConfigMessage, isForeignPath, resolveOutputDir } from "../../src/core/paths.js";
import { agentForStage } from "../../src/agent/agents.js";
import { defaultConfig } from "../../src/config/config.js";

describe("cross-environment paths (Windows ↔ WSL)", () => {
  it("detects other-platform absolute paths", () => {
    expect(isForeignPath("/mnt/c/Users/x", "win32")).toBe(true);
    expect(isForeignPath("C:\\Users\\x", "win32")).toBe(false);
    expect(isForeignPath("C:\\Users\\x", "linux")).toBe(true);
    expect(isForeignPath("\\\\server\\share", "linux")).toBe(true);
    expect(isForeignPath("/mnt/c/Users/x", "linux")).toBe(false);
    expect(foreignConfigMessage(["/mnt/c/Users/x"], "win32")).toContain("다른 환경에서 만들어졌습니다");
    expect(foreignConfigMessage(["C:\\Users\\x"], "win32")).toBeNull();
  });

  it("drops a recorded local CLI path that does not exist on this machine", () => {
    const c = defaultConfig({ university: { input: "", keywords: [] }, scanFolders: [], agent: "claude" });
    c.agents.claude.env = { CLAUDE_CODE_EXECUTABLE: "/home/user/.local/bin/claude", KEEP: "1" };
    expect(agentForStage(c, "judge", { exists: () => false }).env).toEqual({ KEEP: "1", ANTHROPIC_MODEL: "opus" });
    expect(agentForStage(c, "judge", { exists: () => true }).env?.CLAUDE_CODE_EXECUTABLE).toBe("/home/user/.local/bin/claude");
  });
});

describe("resolveOutputDir default location", () => {
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, P: process.env.MP_POINTER_FILE, O: process.env.MP_OUTPUT_DIR };
  const dirs: string[] = [];
  afterEach(async () => {
    for (const [k, v] of [["HOME", saved.HOME], ["USERPROFILE", saved.USERPROFILE], ["MP_POINTER_FILE", saved.P], ["MP_OUTPUT_DIR", saved.O]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  it("falls back to ~/Documents/MasterPortfolio when there is no pointer file", async () => {
    const home = await mkTmp("mp-home-"); dirs.push(home);
    process.env.HOME = home; process.env.USERPROFILE = home;
    delete process.env.MP_POINTER_FILE; delete process.env.MP_OUTPUT_DIR;
    expect(await resolveOutputDir()).toBeNull();
    const out = join(home, "Documents", "MasterPortfolio");
    await mkdir(join(out, ".mp"), { recursive: true });
    await writeFile(join(out, ".mp", "config.json"), "{}");
    expect(await resolveOutputDir()).toBe(out);
  });
});
