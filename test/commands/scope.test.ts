import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runScopeCommand } from "../../src/commands/scope.js";
import { defaultConfig, loadConfig, saveConfig } from "../../src/config/config.js";
import { normalizePath } from "../../src/core/paths.js";
import { main } from "../../src/cli.js";
import { mkTmp } from "../helpers/tmp.js";

const FAKE = resolve("test/fake-agent/fake-agent.ts");
const TSX = pathToFileURL(resolve("node_modules/tsx/dist/loader.mjs")).href;
const dirs: string[] = [];
const body = "내용 ".repeat(100);

async function setup(scenario: string, extraEnv: Record<string, string> = {}) {
  const out = await mkTmp("mp-out-"); const src = await mkTmp("mp-src-");
  dirs.push(out, src);
  const put = async (...p: string[]) => { await mkdir(join(src, ...p.slice(0, -1)), { recursive: true }); await writeFile(join(src, ...p), body); };
  await put("과제", "보고서.md");
  await put("EXCL-설치", "readme.md");
  await put("EXCL-설치", "내프로젝트", "기획.md"); // exclude 아래 폴더는 대상이 아님
  await put("ASK-모음", "자료.md");
  await put("중요자료", "비밀.md"); // 민감 폴더는 보내지 않음
  const c = defaultConfig({ university: { input: "", keywords: [] }, scanFolders: [src], agent: "claude" });
  const log = join(out, "fake.jsonl");
  c.agents.claude = { command: process.execPath, args: ["--import", TSX, FAKE], env: { FAKE_AGENT_SCENARIO: scenario, FAKE_AGENT_LOG: log, FAKE_AGENT_STATE: join(out, "calls"), ...extraEnv } };
  await saveConfig(out, c);
  process.env.MP_OUTPUT_DIR = out;
  return { out, src, log, key: (...p: string[]) => normalizePath(join(src, ...p)) };
}
const readLog = async (log: string) => { try { return (await readFile(log, "utf8")).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };

describe("mp scope (§5.5)", () => {
  let lines: string[];
  beforeEach(() => { lines = []; vi.spyOn(console, "log").mockImplementation((...a) => { lines.push(a.join(" ")); }); });
  afterEach(async () => {
    vi.restoreAllMocks();
    delete process.env.MP_OUTPUT_DIR;
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  it("stores LLM include/exclude, asks y/n/s for ask folders, and never sends sensitive folders", async () => {
    const { out, log, key } = await setup("scope-mixed");
    const asked: string[] = [];
    const code = await runScopeCommand({ askFolder: async (f, q) => { asked.push(`${f.key}|${q}`); return "n"; }, logPrompts: true });
    expect(code).toBe(0);
    const ds = (await loadConfig(out)).scope.decisions;
    expect(ds[key("과제")]).toMatchObject({ decision: "include", by: "llm" });
    expect(ds[key("EXCL-설치")]).toMatchObject({ decision: "exclude", by: "llm" });
    expect(ds[key("ASK-모음")]).toMatchObject({ decision: "exclude", by: "user" });
    expect(asked).toEqual([`${key("ASK-모음")}|ASK-모음 폴더는 직접 만든 자료인가요?`]);
    const sent = (await readLog(log)).filter((o) => o.scope);
    expect(sent).toHaveLength(1);
    expect(sent[0].model).toBe("haiku");
    expect(sent[0].text.startsWith("[범위 단계]")).toBe(true);
    expect(sent[0].text).not.toContain("중요자료");
    expect(sent[0].text).not.toContain("비밀.md");
    expect(sent[0].text).not.toContain("보고서.md 내용");
    // 처음 순회에는 판단이 없으므로 EXCL-설치/내프로젝트도 함께 판단된다
    expect(ds[key("EXCL-설치", "내프로젝트")]).toMatchObject({ decision: "exclude", by: "llm" });
    expect(lines).toContain("폴더 범위: 포함 1, 제외 3, 나중에 0");
    const logs = await readdir(join(out, ".mp", "logs"));
    const scopeLog = await readFile(join(out, ".mp", "logs", logs.find((n) => n.startsWith("scope-"))!), "utf8");
    expect(scopeLog).toMatch(/\[stage scope\] model=haiku batches=1 prompts=1 chars=\d+/);
    expect(scopeLog).toContain("[usage] stage=scope");
    expect(logs.some((n) => n.startsWith("prompts-scope-"))).toBe(true);

    // 두 번째 실행: 판단 없는 폴더가 없으면 아무것도 보내지 않는다
    const before = sent.length;
    expect(await runScopeCommand({ askFolder: async () => "y" })).toBe(0);
    expect((await readLog(log)).filter((o) => o.scope)).toHaveLength(before);
    expect(lines).toContain("판단이 없는 새 폴더가 없습니다.");
  });

  it("treats ask as later (s) with --yes and does not store it", async () => {
    const { out, key } = await setup("scope-mixed");
    const askFolder = vi.fn(async () => "y" as const);
    expect(await runScopeCommand({ yes: true, askFolder })).toBe(0);
    expect(askFolder).not.toHaveBeenCalled();
    const ds = (await loadConfig(out)).scope.decisions;
    expect(ds[key("ASK-모음")]).toBeUndefined();
    expect(lines).toContain("폴더 범위: 포함 1, 제외 2, 나중에 1");
  });

  it("--list prints decisions and --reset removes a path and its descendants", async () => {
    const { out, src, key } = await setup("scope-mixed");
    await runScopeCommand({ yes: true });
    lines.length = 0;
    expect(await runScopeCommand({ list: true })).toBe(0);
    expect(lines.some((l) => l.startsWith("제외\tLLM\t") && l.endsWith(key("EXCL-설치")))).toBe(true);
    expect(await runScopeCommand({ reset: join(src, "EXCL-설치") + "/" })).toBe(0);
    const ds = (await loadConfig(out)).scope.decisions;
    expect(Object.keys(ds)).toEqual([key("과제")]);
  });

  it("leaves folders undecided when the reply cannot be parsed", async () => {
    const { out } = await setup("scope-garbage");
    expect(await runScopeCommand({ yes: true })).toBe(0);
    expect((await loadConfig(out)).scope.decisions).toEqual({});
    expect(lines).toContain("폴더 범위: 포함 0, 제외 0, 나중에 4");
  });

  it("re-asks once for missing ids in the same session", async () => {
    const { out, log } = await setup("scope-partial");
    expect(await runScopeCommand({ yes: true })).toBe(0);
    expect(Object.keys((await loadConfig(out)).scope.decisions)).toHaveLength(4);
    expect((await readLog(log)).filter((o) => o.scope)).toHaveLength(2);
  });

  it("stops with code 3 on a rate limit and stores nothing", async () => {
    const { out } = await setup("scope-rate-limit");
    expect(await runScopeCommand({ yes: true })).toBe(3);
    expect((await loadConfig(out)).scope.decisions).toEqual({});
    expect(lines.some((l) => l.includes("사용량 한도(범위 단계)"))).toBe(true);
  });

  it("restarts the agent once after a crash", async () => {
    const { out, log } = await setup("scope-crash-once");
    expect(await runScopeCommand({ yes: true })).toBe(0);
    expect(Object.keys((await loadConfig(out)).scope.decisions)).toHaveLength(4);
    expect((await readLog(log)).filter((o) => "processCwd" in o)).toHaveLength(2);
  });

  it("is wired on the CLI", async () => {
    await setup("scope-mixed");
    expect(await main(["node", "mp", "scope", "--list"])).toBe(0);
    expect(lines).toContain("저장된 폴더 범위 판단이 없습니다.");
  });
});
