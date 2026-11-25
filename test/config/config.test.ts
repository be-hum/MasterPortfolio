import { describe, it, expect } from "vitest";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_AGENTS } from "../../src/agent/agents.js";
import { defaultConfig, loadConfig, saveConfig } from "../../src/config/config.js";
import { mkTmp } from "../helpers/tmp.js";

describe("config", () => {
  it("round-trips through disk with defaults", async () => {
    const dir = await mkTmp();
    const c = defaultConfig({ university: { input: "연세대", keywords: ["연세대", "YU"] }, scanFolders: ["/a"], agent: "claude" });
    await saveConfig(dir, c);
    const loaded = await loadConfig(dir);
    expect(loaded).toEqual(c);
    expect(loaded.limits.maxFileChars).toBe(30000);
    expect(loaded.limits.maxFileBytes).toBe(52428800);
    expect(loaded.agents.claude).toBeDefined();
  });

  it("keeps every agent lockdown setting intact through save/load", async () => {
    const dir = await mkTmp();
    try {
      await saveConfig(dir, defaultConfig({ university: { input: "", keywords: [] }, scanFolders: [], agent: "claude" }));
      const loaded = await loadConfig(dir);
      expect(loaded.agents).toEqual(DEFAULT_AGENTS);
      expect(loaded.agents.claude.sessionMeta).toEqual(DEFAULT_AGENTS.claude.sessionMeta);
      expect(JSON.parse(loaded.agents.codex.env!.CODEX_CONFIG)).toEqual(JSON.parse(DEFAULT_AGENTS.codex.env!.CODEX_CONFIG));
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("defaults models to haiku/opus and loads an existing config without models (§9.6)", async () => {
    const dir = await mkTmp();
    try {
      const c = defaultConfig({ university: { input: "", keywords: [] }, scanFolders: [], agent: "claude" });
      expect(c.models).toEqual({ triage: "haiku", extract: "haiku", judge: "opus" });
      await saveConfig(dir, c);
      const p = join(dir, ".mp", "config.json");
      const raw = JSON.parse(await readFile(p, "utf8"));
      delete raw.models;
      await mkdir(join(dir, ".mp"), { recursive: true });
      await writeFile(p, JSON.stringify(raw));
      expect((await loadConfig(dir)).models).toEqual({ triage: "haiku", extract: "haiku", judge: "opus" });
      // models는 있지만 triage가 없는 config(9.7 이전)
      await writeFile(p, JSON.stringify({ ...raw, models: { extract: "sonnet", judge: "opus" } }));
      expect((await loadConfig(dir)).models).toEqual({ triage: "haiku", extract: "sonnet", judge: "opus" });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("still loads a config that has the old sessionRotateBatches limit (§9.7 A, ignored)", async () => {
    const dir = await mkTmp();
    try {
      const c = defaultConfig({ university: { input: "", keywords: [] }, scanFolders: [], agent: "claude" });
      await saveConfig(dir, c);
      const p = join(dir, ".mp", "config.json");
      const raw = JSON.parse(await readFile(p, "utf8"));
      raw.limits.sessionRotateBatches = 5;
      delete raw.budget; // 9.8 이전 config
      await writeFile(p, JSON.stringify(raw));
      const loaded = await loadConfig(dir);
      expect(loaded.limits.batchChars).toBe(30000);
      expect(loaded.budget).toEqual({ fiveHourShare: 0.3, planScale: 1 });
      expect(c.budget).toEqual({ fiveHourShare: 0.3, planScale: 1 });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

describe("config scope.decisions (§5.5)", () => {
  it("defaults to no decisions and loads a config written before 5.5", async () => {
    const dir = await mkTmp();
    try {
      const c = defaultConfig({ university: { input: "", keywords: [] }, scanFolders: [], agent: "claude" });
      expect(c.scope).toEqual({ decisions: {}, questions: {} });
      await saveConfig(dir, c);
      const p = join(dir, ".mp", "config.json");
      const raw = JSON.parse(await readFile(p, "utf8"));
      delete raw.scope;
      await writeFile(p, JSON.stringify(raw));
      expect((await loadConfig(dir)).scope).toEqual({ decisions: {}, questions: {} });
      raw.scope = { decisions: { "/a": { decision: "exclude", by: "user", at: "2026-11-24T00:00:00.000Z" } } };
      await writeFile(p, JSON.stringify(raw));
      expect((await loadConfig(dir)).scope.decisions["/a"].by).toBe("user");
      raw.scope = { decisions: { "/a": { decision: "ask", by: "llm", at: "x" } } };
      await writeFile(p, JSON.stringify(raw));
      await expect(loadConfig(dir)).rejects.toThrow();
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
