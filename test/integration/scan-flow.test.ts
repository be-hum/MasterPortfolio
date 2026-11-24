import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdir, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { main } from "../../src/cli.js";
import { loadConfig, saveConfig } from "../../src/config/config.js";
import { PII_PATTERNS } from "../../src/privacy/mask.js";
import { makeDocx } from "../helpers/ooxml.js";
import { parseCard } from "../../src/store/frontmatter.js";
import { normalizePath } from "../../src/core/paths.js";
import { mkTmp } from "../helpers/tmp.js";

const FAKE = resolve("test/fake-agent/fake-agent.ts");
// 에이전트는 빈 임시 폴더에서 실행되므로 tsx 로더를 절대 URL로 지정한다
const TSX = pathToFileURL(resolve("node_modules/tsx/dist/loader.mjs")).href;
const dirs: string[] = [];

async function tmp(prefix: string) {
  const d = await mkTmp(prefix); dirs.push(d); return d;
}

async function fixture() {
  const src = await tmp("mp-src-");
  await mkdir(join(src, "연세대", "3학년"), { recursive: true });
  for (let i = 0; i < 6; i++) {
    await writeFile(join(src, "연세대", "3학년", `과제${i}.md`), `과제 ${i}: 결과 정확도 9${i}%. 담당자 900101-1234567, 010-9876-5432, 카드 4111-1111-1111-1111. ` + "본문 ".repeat(2000));
  }
  await writeFile(join(src, "연세대", "자소서.docx"), await makeDocx(["지원 동기", "연락처 02-123-4567"]));
  return src;
}

function expectedSources(src: string) {
  const names = [...Array.from({ length: 6 }, (_, i) => join("3학년", `과제${i}.md`)), "자소서.docx"];
  return names.map((n) => normalizePath(join(src, "연세대", n))).sort();
}

async function cardValues(out: string) {
  const names = await readdir(join(out, "files"));
  return Promise.all(names.map(async (n) => parseCard(await readFile(join(out, "files", n), "utf8")).fm.value));
}

async function cardSources(out: string) {
  const names = await readdir(join(out, "files"));
  const sources = await Promise.all(names.map(async (n) => String(parseCard(await readFile(join(out, "files", n), "utf8")).fm.source)));
  return sources.sort();
}

async function configure(out: string, src: string, env: Record<string, string>) {
  process.env.MP_OUTPUT_DIR = out;
  process.env.MP_ALLOW_TEST_AGENTS = "1";
  expect(await main(["node", "mp", "init", "--non-interactive", "--university", "연세대", "--folders", src, "--agent", "fake"])).toBe(0);
  const c = await loadConfig(out);
  // 가짜 에이전트를 claude 이름으로 등록해 단계별 모델(ANTHROPIC_MODEL) 전달을 확인한다(9.6)
  c.agent = "claude";
  c.agents.claude = { command: process.execPath, args: ["--import", TSX, FAKE], env };
  c.limits.batchChars = 12_000; // 파일 2개 정도씩 묶이도록
  await saveConfig(out, c);
}

describe("scan flow", () => {
  let spies: { mock: { calls: unknown[][] } }[] = [];
  beforeEach(async () => {
    delete process.env.MP_OUTPUT_DIR; process.exitCode = undefined;
    process.env.MP_POINTER_FILE = join(await tmp("mp-ptr-"), "pointer.json");
    // CLI 정상 안내문(console.log)은 삼키고, 오류 출력(stderr/console.error)은 없어야 한다
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    spies = [
      vi.spyOn(console, "error").mockImplementation(() => {}),
      vi.spyOn(process.stderr, "write").mockImplementation(() => true),
    ];
  });
  afterEach(async () => {
    for (const s of spies) expect(s.mock.calls).toEqual([]);
    vi.restoreAllMocks();
    process.exitCode = undefined;
    delete process.env.MP_OUTPUT_DIR; delete process.env.MP_POINTER_FILE; delete process.env.MP_ALLOW_TEST_AGENTS;
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  it("never sends PII patterns to the agent (success criterion 3)", async () => {
    const out = await tmp("mp-out-"); const src = await fixture(); const log = join(out, "fake.jsonl");
    await configure(out, src, { FAKE_AGENT_SCENARIO: "fenced", FAKE_AGENT_LOG: log });
    expect(await main(["node", "mp", "scan", "--yes", "--log-prompts"])).toBe(0);
    const sent = (await readFile(log, "utf8")).trim().split("\n")
      .map((l) => JSON.parse(l) as { text?: string; model?: string | null })
      .filter((o) => typeof o.text === "string");
    const prompts = sent.map((o) => o.text as string);
    expect(prompts.length).toBeGreaterThan(1);
    // 추출은 haiku, 판정은 opus. 판정 프롬프트에는 원문·경로가 없다(9.6)
    const judge = sent.filter((o) => o.text!.includes("<<<CARD id="));
    expect(judge.length).toBeGreaterThan(0);
    expect(judge.every((o) => o.model === "opus")).toBe(true);
    expect(sent.filter((o) => o.text!.includes("<<<FILE id=")).every((o) => o.model === "haiku")).toBe(true);
    for (const j of judge) {
      expect(j.text).not.toContain("본문 본문");
      expect(j.text).not.toContain("결과 정확도");
      expect(j.text).not.toContain(normalizePath(src));
      expect(j.text).not.toContain("3학년");
    }
    expect((await cardValues(out)).every((v) => v === "상" || v === "중" || v === "하")).toBe(true);
    for (const p of prompts) {
      for (const re of PII_PATTERNS) { re.lastIndex = 0; expect(re.test(p)).toBe(false); }
      expect(p).not.toContain("900101-1234567");
      expect(p).not.toContain("010-9876-5432");
      expect(p).not.toContain("4111-1111-1111-1111");
    }
    expect(await cardSources(out)).toEqual(expectedSources(src));
  });

  it("resumes after rate limit without duplicates (Review Focus 5)", async () => {
    const out = await tmp("mp-out-"); const src = await fixture(); const calls = join(out, "calls");
    await configure(out, src, { FAKE_AGENT_SCENARIO: "rate-limit-after-1", FAKE_AGENT_STATE: calls });
    expect(await main(["node", "mp", "scan", "--yes"])).toBe(3);
    const first = await readdir(join(out, "files"));
    expect(first.length).toBeGreaterThan(0);
    expect(first.length).toBeLessThan(7);

    await rm(calls, { force: true });
    const c = await loadConfig(out); c.agents.claude.env = { FAKE_AGENT_SCENARIO: "ok" }; await saveConfig(out, c);
    process.exitCode = undefined;
    expect(await main(["node", "mp", "scan", "--yes"])).toBe(0);
    expect(await cardSources(out)).toEqual(expectedSources(src));
    expect((await cardValues(out)).every((v) => v === "상" || v === "중" || v === "하")).toBe(true);
  });

  it("retries once on bad JSON and still produces all cards", async () => {
    const out = await tmp("mp-out-"); const src = await fixture();
    await configure(out, src, { FAKE_AGENT_SCENARIO: "badjson-once", FAKE_AGENT_STATE: join(out, "calls") });
    expect(await main(["node", "mp", "scan", "--yes"])).toBe(0);
    expect(await cardSources(out)).toEqual(expectedSources(src));
  });
});
