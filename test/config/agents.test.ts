import { describe, it, expect } from "vitest";
import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_AGENTS, V1_AGENTS, agentForStage, withLocalExecutable } from "../../src/agent/agents.js";
import { defaultConfig } from "../../src/config/config.js";
import { mkTmp } from "../helpers/tmp.js";

describe("agents", () => {
  it("v1 excludes antigravity", () => { expect([...V1_AGENTS]).toEqual(["claude", "codex"]); });
  it("claude disables all built-in tools via sessionMeta", () => {
    expect((DEFAULT_AGENTS.claude.sessionMeta as any).claudeCode.options.tools).toEqual([]);
  });
  it("leaves unknown agents unchanged", async () => {
    const cfg = { command: "x", args: [] };
    expect(await withLocalExecutable("fake", cfg)).toBe(cfg);
  });
  it.skipIf(process.platform === "win32")("points claude at the installed CLI found on PATH", async () => {
    const d = await mkTmp(); const bin = join(d, "claude");
    await writeFile(bin, "#!/bin/sh\n"); await chmod(bin, 0o755);
    const oldPath = process.env.PATH;
    process.env.PATH = `${d}:${oldPath}`;
    try {
      const r = await withLocalExecutable("claude", DEFAULT_AGENTS.claude);
      expect(r.env?.CLAUDE_CODE_EXECUTABLE).toBe(bin);
    } finally { process.env.PATH = oldPath; }
  });

  it("on win32 prefers the first .exe from `where` output", async () => {
    const calls: string[] = [];
    const find = async (finder: string, bin: string) => {
      calls.push(`${finder} ${bin}`);
      return "C:\\Users\\kim\\AppData\\Roaming\\npm\\claude\r\nC:\\Users\\kim\\AppData\\Roaming\\npm\\claude.cmd\r\nC:\\Users\\kim\\.local\\bin\\claude.EXE\r\n";
    };
    const r = await withLocalExecutable("claude", DEFAULT_AGENTS.claude, { platform: "win32", find });
    expect(calls).toEqual(["where claude"]);
    expect(r.env?.CLAUDE_CODE_EXECUTABLE).toBe("C:\\Users\\kim\\.local\\bin\\claude.EXE");
  });

  it("on win32 leaves env unset when `where` finds no .exe (bundled CLI is used)", async () => {
    const find = async () => "C:\\npm\\codex\r\nC:\\npm\\codex.cmd\r\n";
    const r = await withLocalExecutable("codex", DEFAULT_AGENTS.codex, { platform: "win32", find });
    expect(r).toBe(DEFAULT_AGENTS.codex);
    expect(r.env?.CODEX_PATH).toBeUndefined();
  });

  it("elsewhere uses the first `which` line", async () => {
    const r = await withLocalExecutable("codex", DEFAULT_AGENTS.codex, { platform: "darwin", find: async (f) => (f === "which" ? "/opt/homebrew/bin/codex\n" : "") });
    expect(r.env?.CODEX_PATH).toBe("/opt/homebrew/bin/codex");
    expect(r.env?.INITIAL_AGENT_MODE).toBe("read-only");
  });
});

describe("agentForStage (§9.6)", () => {
  it("group and review use models.judge and keep extended thinking (11.1, 11.2)", () => {
    const c = cfg("claude");
    c.models.judge = "opus";
    for (const st of ["group", "review"] as const) {
      const a = agentForStage(c, st);
      expect(a.env?.ANTHROPIC_MODEL).toBe("opus");
      expect((a.sessionMeta as any).claudeCode.options.maxThinkingTokens).toBeUndefined();
    }
  });
  const cfg = (agent: string) => defaultConfig({ university: { input: "", keywords: [] }, scanFolders: [], agent });

  it("claude: extract → ANTHROPIC_MODEL=haiku, judge → opus, without mutating the config", () => {
    const c = cfg("claude");
    c.agents.claude = { ...c.agents.claude, env: { CLAUDE_CODE_EXECUTABLE: "/bin/claude" } };
    const before = structuredClone(c);
    const ex = agentForStage(c, "extract", { exists: () => true }), ju = agentForStage(c, "judge", { exists: () => true });
    expect(ex.env).toEqual({ CLAUDE_CODE_EXECUTABLE: "/bin/claude", ANTHROPIC_MODEL: "haiku" });
    expect(ju.env).toEqual({ CLAUDE_CODE_EXECUTABLE: "/bin/claude", ANTHROPIC_MODEL: "opus" });
    expect(c).toEqual(before);
  });

  it("claude: turns extended thinking off for scope/triage/extract and keeps it for judge (§9.7 F)", () => {
    const c = cfg("claude");
    const opts = (st: Parameters<typeof agentForStage>[1]) => (agentForStage(c, st).sessionMeta as any).claudeCode.options;
    for (const st of ["scope", "triage", "extract"] as const) {
      expect(opts(st).maxThinkingTokens, st).toBe(0);
      expect(opts(st).tools).toEqual([]);
    }
    expect(opts("judge").maxThinkingTokens).toBeUndefined();
    expect(opts("judge")).toEqual((DEFAULT_AGENTS.claude.sessionMeta as any).claudeCode.options);
    expect((c.agents.claude.sessionMeta as any).claudeCode.options.maxThinkingTokens).toBeUndefined();
  });

  it("claude: triage → ANTHROPIC_MODEL=models.triage (§9.7 E)", () => {
    const c = cfg("claude");
    expect(agentForStage(c, "triage").env?.ANTHROPIC_MODEL).toBe("haiku");
    c.models.triage = "sonnet";
    expect(agentForStage(c, "triage").env?.ANTHROPIC_MODEL).toBe("sonnet");
    // 폴더 범위 단계(5.5)는 models.triage를 쓴다
    expect(agentForStage(c, "scope").env?.ANTHROPIC_MODEL).toBe("sonnet");
  });

  it("claude: uses custom model names from config", () => {
    const c = cfg("claude");
    c.models = { triage: "haiku", extract: "sonnet", judge: "claude-opus-4-1" };
    expect(agentForStage(c, "judge").env?.ANTHROPIC_MODEL).toBe("claude-opus-4-1");
  });

  it("codex: leaves env untouched unless models.codex is set, then sets CODEX_CONFIG.model", () => {
    const c = cfg("codex");
    expect(agentForStage(c, "extract").env).toEqual(DEFAULT_AGENTS.codex.env);
    expect(agentForStage(c, "judge").env).toEqual(DEFAULT_AGENTS.codex.env);
    c.models.codex = "gpt-5-mini";
    const before = structuredClone(c);
    const e = agentForStage(c, "extract");
    const conf = JSON.parse(e.env!.CODEX_CONFIG);
    expect(conf.model).toBe("gpt-5-mini");
    expect(conf["features.shell_tool"]).toBe(false);
    expect(e.env!.INITIAL_AGENT_MODE).toBe("read-only");
    expect(e.env!.ANTHROPIC_MODEL).toBeUndefined();
    expect(c).toEqual(before);
  });

  it("other agents are returned unchanged", () => {
    const c = cfg("fake");
    c.agents.fake = { command: "x", args: [], env: { A: "1" } };
    expect(agentForStage(c, "extract")).toEqual({ command: "x", args: [], env: { A: "1" } });
  });

  it("throws a clear error when the agent is not configured", () => {
    expect(() => agentForStage(cfg("nope"), "extract")).toThrow(/nope/);
  });
});
