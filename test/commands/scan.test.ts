import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runScan, scanSummary } from "../../src/commands/scan.js";
import { runInit, normalizeFolderInput } from "../../src/commands/init.js";
import { homedir } from "node:os";
import { main } from "../../src/cli.js";
import { defaultConfig, saveConfig } from "../../src/config/config.js";
import { mkTmp } from "../helpers/tmp.js";
import { normalizePath } from "../../src/core/paths.js";

const FAKE = resolve("test/fake-agent/fake-agent.ts");
// 에이전트는 빈 임시 폴더에서 실행되므로 tsx 로더를 절대 URL로 지정한다
const TSX = pathToFileURL(resolve("node_modules/tsx/dist/loader.mjs")).href;
const dirs: string[] = [];

async function setup(scenario: string) {
  const out = await mkTmp("mp-out-"); const src = await mkTmp("mp-src-");
  dirs.push(out, src);
  await mkdir(join(src, "과제"), { recursive: true });
  await writeFile(join(src, "과제", "회의록.md"), "캡스톤 회의록. 연락처 010-1234-5678. " + "내용 ".repeat(100));
  await writeFile(join(src, "과제", "주민등록등본.txt"), "민감 ".repeat(100));
  await writeFile(join(src, "과제", "긴글.txt"), "가".repeat(31_000));
  // 가짜 에이전트를 claude 이름으로 등록해 단계별 ANTHROPIC_MODEL 전달을 확인한다(9.6)
  const c = defaultConfig({ university: { input: "", keywords: [] }, scanFolders: [src], agent: "claude" });
  const log = join(out, "fake.jsonl");
  c.agents.claude = { command: process.execPath, args: ["--import", TSX, FAKE], env: { FAKE_AGENT_SCENARIO: scenario, FAKE_AGENT_LOG: log, FAKE_AGENT_STATE: join(out, "calls") } };
  await saveConfig(out, c);
  process.env.MP_OUTPUT_DIR = out;
  return { out, src, log };
}

describe("runScan", () => {
  beforeEach(() => { delete process.env.MP_OUTPUT_DIR; vi.spyOn(console, "log").mockImplementation(() => {}); });
  afterEach(async () => {
    vi.restoreAllMocks();
    delete process.env.MP_OUTPUT_DIR;
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  it("creates cards, skips sensitive and long files, masks phone numbers", async () => {
    const { out, log } = await setup("ok");
    const { code, report } = await runScan({ yes: true });
    expect(code).toBe(0);
    expect(report!.created).toHaveLength(1);
    expect(report!.skippedSensitive.map((s) => s.reason)).toEqual(["주민등록"]);
    expect(report!.skippedLong[0].chars).toBe(31_000);
    const prompts = await readFile(log, "utf8");
    expect(prompts).toContain("[전화번호]");
    expect(prompts).not.toContain("010-1234-5678");
    expect(await readdir(join(out, "files"))).toHaveLength(1);
    expect(await readFile(join(out, "index.md"), "utf8")).toContain("제목 f");
    const state = JSON.parse(await readFile(join(out, ".mp", "state.json"), "utf8"));
    const statuses = Object.values(state.files).map((e: any) => e.status).sort();
    expect(statuses).toEqual(["done", "skipped_long", "skipped_sensitive"]);
    expect(state.last_scan).not.toBeNull();
    const reports = await readdir(join(out, "reports"));
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatch(/^scan-\d{4}-\d{2}-\d{2}-\d{4}\.md$/);
    const logs = await readdir(join(out, ".mp", "logs"));
    expect(logs.some((n) => n.startsWith("scan-"))).toBe(true);
    expect(logs.some((n) => n.startsWith("prompts-"))).toBe(false);
  });

  it("never sends account secrets: recovery-code lists and API keys in innocently named files are skipped", async () => {
    const { src, log } = await setup("ok");
    const lines = Array.from({ length: 10 }, (_, i) => `${i}a1b2-c3d4${i}`.slice(0, 11)).join("\n");
    await writeFile(join(src, "과제", "메모.txt"), "계정 정리\n" + lines + "\n" + "여백 ".repeat(50));
    await writeFile(join(src, "과제", "설정노트.md"), "배포 설정\nOPENAI=sk-proj-" + "Z9".repeat(20) + "\n" + "설명 ".repeat(80));
    const { report } = await runScan({ yes: true });
    const reasons = report!.skippedSensitive.map((s) => s.reason).sort();
    expect(reasons).toEqual(["API 키·토큰", "복구 코드", "주민등록"].sort());
    const prompts = await readFile(log, "utf8");
    expect(prompts).not.toContain("a1b2-c3d4");
    expect(prompts).not.toContain("sk-proj-Z9");
    expect(prompts).not.toContain("메모.txt");
  });

  it("reports stage progress lines for the UI when MP_PROGRESS=1 (walk → scope → hash → triage → extract → judge, ending done=total)", async () => {
    await setup("ok");
    process.env.MP_PROGRESS = "1";
    const lines: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    vi.spyOn(process.stdout, "write").mockImplementation(((s: string | Uint8Array, ...rest: unknown[]) => {
      if (typeof s === "string" && s.startsWith("@@progress ")) { lines.push(s); return true; }
      return (orig as (...a: unknown[]) => boolean)(s, ...rest);
    }) as never);
    try { expect((await runScan({ yes: true })).code).toBe(0); } finally { delete process.env.MP_PROGRESS; }
    const evs = lines.map((l) => JSON.parse(l.slice("@@progress ".length)));
    const stages = [...new Set(evs.map((e) => e.stage))];
    expect(stages).toEqual(["walk", "scope", "hash", "triage", "extract", "judge"]);
    for (const st of stages) { const last = evs.filter((e) => e.stage === st).at(-1); expect(last.done).toBe(last.total); }
  });

  it("scanSummary says when nothing new was analysed, and lists what was skipped", () => {
    const base = { startedAt: "x", created: [], changed: [], skippedSensitive: [], skippedLarge: [{ path: "a.pdf", size: 5e7 }], skippedLong: [], extractFailed: [], analysisFailed: [], inaccessible: [], unsupported: 0, stoppedReason: null, judgement: { judged: 0, unjudged: 0, skippedEdited: [] } };
    expect(scanSummary(base)).toBe("새로 분석할 자료 없음 · 크기 초과 1개");
    expect(scanSummary({ ...base, changed: ["a", "b"] })).toContain("원본이 바뀐 파일 2개(아직 다시 분석하지 않음)");
    expect(scanSummary({ ...base, created: ["files/a.md", "files/b.md"], judgement: { judged: 2, unjudged: 0, skippedEdited: [] }, skippedLarge: [], skippedIrrelevant: ["x"] }))
      .toBe("새 카드 2개 · 판정 2개 · 무관해 보여 제외 1개");
  });

  it("second scan sends nothing new", async () => {
    const { log } = await setup("ok");
    await runScan({ yes: true });
    const before = (await readFile(log, "utf8")).split("\n").length;
    const { report } = await runScan({ yes: true });
    expect(report!.created).toHaveLength(0);
    expect((await readFile(log, "utf8")).split("\n").length).toBe(before);
  });

  it("returns code 2 when not initialized", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.MP_POINTER_FILE = join(await mkTmp("mp-ptr-").then((d) => (dirs.push(d), d)), "none.json");
    try {
      const { code, report } = await runScan({ yes: true });
      expect(code).toBe(2);
      expect(report).toBeNull();
      expect(err).toHaveBeenCalled();
    } finally { delete process.env.MP_POINTER_FILE; }
  });

  it("restarts the agent once after a crash and finishes all cards", async () => {
    const { out, src, log } = await setup("crash-once");
    await writeFile(join(src, "과제", "발표.md"), "발표 자료 정리. " + "본문 ".repeat(100));
    const { code, report } = await runScan({ yes: true });
    expect(code).toBe(0);
    expect(report!.stoppedReason).toBeNull();
    expect(report!.created).toHaveLength(2);
    expect(await readdir(join(out, "files"))).toHaveLength(2);
    // 추출 에이전트 프로세스가 두 번 실행됨(크래시 후 재시작). 맨 앞은 폴더 범위(5.5)·선별(9.7 E)
    const starts = (await readFile(log, "utf8")).trim().split("\n").map((l) => JSON.parse(l)).filter((o) => "processCwd" in o);
    expect(starts.map((o) => o.model)).toEqual(["haiku", "haiku", "haiku", "haiku", "opus"]);
  });

  it("stops with code 3 on rate limit and keeps already created cards", async () => {
    const { out, src } = await setup("rate-limit-after-1");
    const c = JSON.parse(await readFile(join(out, ".mp", "config.json"), "utf8"));
    c.limits.batchChars = 100; // 파일마다 배치 하나
    await writeFile(join(out, ".mp", "config.json"), JSON.stringify(c));
    await writeFile(join(src, "과제", "발표.md"), "발표 자료 정리. " + "본문 ".repeat(100));
    const { code, report } = await runScan({ yes: true });
    expect(code).toBe(3);
    expect(report!.created).toHaveLength(1);
    expect(report!.stoppedReason).toContain("사용량 한도 — 카드 1개 생성, 분석 실패 0개, 남은 파일 1개");
    const reportFile = (await readdir(join(out, "reports")))[0];
    expect(await readFile(join(out, "reports", reportFile), "utf8")).toContain("중단됨");
  });

  it("asks before analyzing and stops when declined; --limit and --log-prompts", async () => {
    const { out, src, log } = await setup("ok");
    await writeFile(join(src, "과제", "발표.md"), "발표 자료 정리. " + "본문 ".repeat(100));
    const asked: string[] = [];
    const r1 = await runScan({ confirm: async (m) => { asked.push(m); return false; } });
    expect(r1.code).toBe(0);
    expect(asked.at(-1)).toMatch(/후보 2개, 배치 1개/);
    expect(r1.report!.created).toHaveLength(0);
    await expect(readFile(log, "utf8")).rejects.toThrow();
    const r2 = await runScan({ yes: true, limit: 1, logPrompts: true });
    expect(r2.report!.created).toHaveLength(1);
    const logs = await readdir(join(out, ".mp", "logs"));
    const p = logs.find((n) => n.startsWith("prompts-"))!;
    expect(await readFile(join(out, ".mp", "logs", p), "utf8")).toContain("<<<FILE id=f1");
    const r3 = await runScan({ yes: true });
    expect(r3.report!.created).toHaveLength(1);
  });

  it("normalizes changed paths and reports them", async () => {
    const { src } = await setup("ok");
    await runScan({ yes: true });
    await writeFile(join(src, "과제", "회의록.md"), "수정된 회의록. " + "내용 ".repeat(120));
    const { report } = await runScan({ yes: true });
    expect(report!.changed).toHaveLength(1);
    expect(report!.changed[0]).not.toContain("\\");
    expect(report!.changed[0]).toMatch(/회의록\.md$/);
  });

  it("masks PII in file names before they reach the agent", async () => {
    const { src, log } = await setup("ok");
    await writeFile(join(src, "과제", "홍길동_010-1234-5678.md"), "프로젝트 자료. " + "본문 ".repeat(100));
    await writeFile(join(src, "과제", "900101-1234567_자료.md"), "다른 자료. " + "본문 ".repeat(100));
    const { report } = await runScan({ yes: true });
    expect(report!.created).toHaveLength(3);
    const sent = await readFile(log, "utf8");
    expect(sent).toContain("[전화번호]");
    expect(sent).not.toContain("010-1234-5678");
    expect(sent).toContain("[주민번호]");
    expect(sent).not.toContain("900101-1234567");
  });

  it("stops with code 3 when the agent crashes again after the restart", async () => {
    const { out } = await setup("crash-always");
    const { code, report } = await runScan({ yes: true });
    expect(code).toBe(3);
    expect(report!.stoppedReason).toMatch(/^에이전트 오류/);
    expect(report!.created).toHaveLength(0);
    expect(await readdir(join(out, "reports"))).toHaveLength(1);
  });

  it("returns code 3 with a report when the agent config is missing", async () => {
    const { out } = await setup("ok");
    const c = JSON.parse(await readFile(join(out, ".mp", "config.json"), "utf8"));
    c.agent = "nope";
    await writeFile(join(out, ".mp", "config.json"), JSON.stringify(c));
    const { code, report } = await runScan({ yes: true });
    expect(code).toBe(3);
    expect(report!.stoppedReason).toContain("에이전트 설정 없음");
    expect(await readdir(join(out, "reports"))).toHaveLength(1);
  });

  it("returns code 3 instead of throwing when the output folder is not writable", async () => {
    const { out } = await setup("ok");
    await writeFile(join(out, ".mp", "logs"), "파일이라 폴더를 만들 수 없음");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { code, report } = await runScan({ yes: true });
    expect(code).toBe(3);
    expect(report!.stoppedReason).toContain("결과 폴더에 쓸 수 없음");
  });

  it("does not re-send a new copy of an already-carded file and records it as a duplicate", async () => {
    const { out, src, log } = await setup("ok");
    await writeFile(join(src, "과제", "회의록-사본0.md"), await readFile(join(src, "과제", "회의록.md"))); // 같은 스캔 안의 사본
    expect((await runScan({ yes: true })).report!.created).toHaveLength(1);
    const before = await readFile(log, "utf8");
    const copy = join(src, "과제", "회의록 - 복사본.md");
    await copyFile(join(src, "과제", "회의록.md"), copy);
    const { code, report } = await runScan({ yes: true });
    expect(code).toBe(0);
    expect(report!.created).toHaveLength(0);
    expect(await readFile(log, "utf8")).toBe(before);
    expect(report!.knownDuplicates).toEqual([{ path: normalizePath(copy), card: expect.stringMatching(/^files\//) }]);
    const state = JSON.parse(await readFile(join(out, ".mp", "state.json"), "utf8"));
    expect(state.files[normalizePath(copy)]).toMatchObject({ status: "duplicate", card: null });
    const pair = ["회의록.md", "회의록-사본0.md"].map((n) => state.files[normalizePath(join(src, "과제", n))].status).sort();
    expect(pair).toEqual(["done", "duplicate"]);
    const reports = await readdir(join(out, "reports"));
    const texts = await Promise.all(reports.map((n) => readFile(join(out, "reports", n), "utf8")));
    expect(texts.filter((t) => t.includes("이미 분석된 파일의 사본 (건너뜀) (1)"))).toHaveLength(1);
    expect(await readdir(join(out, "files"))).toHaveLength(1);
    // 세 번째 스캔: 보고할 사본도 없음
    expect((await runScan({ yes: true })).report!.knownDuplicates).toEqual([]);
  });

  it("never analyzes its own output folder when it is inside a scan folder", async () => {
    const { out: firstOut, src } = await setup("ok");
    const out = join(src, "MasterPortfolio");
    const c = JSON.parse(await readFile(join(firstOut, ".mp", "config.json"), "utf8"));
    const log = join(out, "fake.jsonl");
    c.agents.claude.env = { FAKE_AGENT_SCENARIO: "ok", FAKE_AGENT_LOG: log };
    await mkdir(join(out, ".mp"), { recursive: true });
    await writeFile(join(out, ".mp", "config.json"), JSON.stringify(c));
    process.env.MP_OUTPUT_DIR = out;
    const r1 = await runScan({ yes: true });
    expect(r1.report!.created).toHaveLength(1);
    const before = await readFile(log, "utf8");
    const r2 = await runScan({ yes: true });
    expect(r2.report!.created).toHaveLength(0);
    expect(await readFile(log, "utf8")).toBe(before);
    const state = JSON.parse(await readFile(join(out, ".mp", "state.json"), "utf8"));
    expect(Object.keys(state.files).filter((k) => k.startsWith(normalizePath(out)))).toEqual([]);
  });

  it("records an extractor exception as extract_failed and keeps scanning", async () => {
    const { out } = await setup("ok");
    const { code, report } = await runScan({
      yes: true,
      extractorFor: () => ({ id: "boom", extract: async () => { throw new Error("boom"); } }),
    });
    expect(code).toBe(0);
    expect(report!.extractFailed.map((e) => e.reason)).toEqual(["error: boom", "error: boom"]);
    const state = JSON.parse(await readFile(join(out, ".mp", "state.json"), "utf8"));
    expect(Object.values(state.files).map((e: any) => e.status).sort()).toEqual(["extract_failed", "extract_failed", "skipped_sensitive"]);
  });

  it("stops when the agent keeps answering without JSON, logs the reply, and leaves files for the next scan", async () => {
    const { out, src, log } = await setup("garbage");
    const c = JSON.parse(await readFile(join(out, ".mp", "config.json"), "utf8"));
    c.limits.batchChars = 100; // 파일마다 배치 하나
    await writeFile(join(out, ".mp", "config.json"), JSON.stringify(c));
    await writeFile(join(src, "과제", "발표.md"), "발표 자료 정리. " + "본문 ".repeat(100));
    await writeFile(join(src, "과제", "메모.md"), "메모 정리. " + "본문 ".repeat(100));
    const { code, report } = await runScan({ yes: true });
    expect(code).toBe(3);
    expect(report!.stoppedReason).toContain("연속으로 분석 결과를 돌려주지 않았습니다");
    // 회로 차단기는 재시작하지 않는다: 추출 에이전트 1회 실행(+ 범위·선별 1회씩), 배치 2개만 전송(R2)
    const sent = (await readFile(log, "utf8")).trim().split("\n").map((l) => JSON.parse(l));
    expect(sent.filter((o) => "processCwd" in o)).toHaveLength(3);
    expect(sent.filter((o) => typeof o.text === "string" && o.text.includes("<<<FILE id="))).toHaveLength(2);
    expect(report!.analysisFailed).toEqual([]);
    const state = JSON.parse(await readFile(join(out, ".mp", "state.json"), "utf8"));
    expect(Object.values(state.files).map((e: any) => e.status)).not.toContain("analysis_failed");
    const logs = await readdir(join(out, ".mp", "logs"));
    const scanLog = await readFile(join(out, ".mp", "logs", logs.find((n) => n.startsWith("scan-"))!), "utf8");
    expect(scanLog).toContain("[unparsed reply]");
    expect(scanLog).toContain("선택한 모델을 사용할 수 없습니다");
  });

  it("extracts with haiku and judges with opus, sending only card summaries to the judge (§9.6)", async () => {
    const { out, src, log } = await setup("ok");
    await writeFile(join(src, "과제", "발표.md"), "발표 자료 정리 UNIQUE-SOURCE-TEXT. " + "본문 ".repeat(100));
    const { code, report } = await runScan({ yes: true });
    expect(code).toBe(0);
    const lines = (await readFile(log, "utf8")).trim().split("\n").map((l) => JSON.parse(l));
    expect(lines.filter((o) => "processCwd" in o).map((o) => o.model)).toEqual(["haiku", "haiku", "haiku", "opus"]);
    const prompts = lines.filter((o) => typeof o.text === "string");
    const extract = prompts.filter((o) => o.text.includes("<<<FILE id="));
    const judge = prompts.filter((o) => o.text.includes("<<<CARD id="));
    expect(extract.length).toBeGreaterThan(0);
    expect(judge).toHaveLength(1);
    expect(extract.every((o) => o.model === "haiku")).toBe(true);
    expect(judge.every((o) => o.model === "opus")).toBe(true);
    expect(extract.some((o) => o.text.includes("UNIQUE-SOURCE-TEXT"))).toBe(true);
    for (const j of judge) {
      expect(j.text).not.toContain("UNIQUE-SOURCE-TEXT");
      expect(j.text).not.toContain("캡스톤 회의록");
      expect(j.text).not.toContain(normalizePath(src));
      expect(j.text).not.toContain("발표.md");
      expect(j.text).not.toContain("files/");
      expect(j.text).not.toContain("발췌");
    }
    const cards = await readdir(join(out, "files"));
    expect(cards).toHaveLength(2);
    for (const n of cards) {
      const t = await readFile(join(out, "files", n), "utf8");
      expect(t).toMatch(/^value: (상|중|하)$/m);
      expect(t).toMatch(/^value_reason: 판정 근거 c\d+$/m);
    }
    expect(report!.judgement).toEqual({ judged: 2, unjudged: 0, skippedEdited: [] });
    expect(await readFile(join(out, "index.md"), "utf8")).not.toContain("미판정");
    // 판정 후 state 해시·스냅샷이 갱신되어 다음 스캔에서 편집으로 보이지 않고 아무것도 보내지 않는다
    const state = JSON.parse(await readFile(join(out, ".mp", "state.json"), "utf8"));
    const done = Object.values(state.files).filter((e: any) => e.status === "done") as any[];
    expect(done.every((e) => ["상", "중", "하"].includes(e.card_snapshot.value))).toBe(true);
    const before = await readFile(log, "utf8");
    const confirm = vi.fn(async () => true);
    const r2 = await runScan({ confirm });
    expect(r2.report!.created).toHaveLength(0);
    expect(confirm).not.toHaveBeenCalled();
    expect(await readFile(log, "utf8")).toBe(before);
    const logs = await readdir(join(out, ".mp", "logs"));
    const scanLogs = await Promise.all(logs.filter((n) => n.startsWith("scan-")).map((n) => readFile(join(out, ".mp", "logs", n), "utf8")));
    expect(scanLogs.join("\n")).toMatch(/\[stage extract\] model=haiku batches=1 prompts=1 chars=\d+/);
    expect(scanLogs.join("\n")).toMatch(/\[stage judge\] model=opus batches=1 prompts=1 chars=\d+/);
    expect(scanLogs.join("\n")).toMatch(/\[stage triage\] model=haiku batches=1 prompts=1 chars=\d+/);
  });

  it("leaves cards unjudged when the judge stage hits the rate limit; the next scan only judges (§9.6)", async () => {
    const { out, log } = await setup("judge-rate-limit");
    const r1 = await runScan({ yes: true });
    expect(r1.code).toBe(3);
    expect(r1.report!.created).toHaveLength(1);
    expect(r1.report!.stoppedReason).toContain("사용량 한도(판정 단계)");
    expect(r1.report!.judgement).toEqual({ judged: 0, unjudged: 1, skippedEdited: [] });
    const [card] = await readdir(join(out, "files"));
    expect(await readFile(join(out, "files", card), "utf8")).toMatch(/^value: null$/m);
    expect(await readFile(join(out, "index.md"), "utf8")).toContain("| 미판정 |");
    const reports = await readdir(join(out, "reports"));
    expect(await readFile(join(out, "reports", reports[0]), "utf8")).toContain("판정 완료 0 / 미판정 1");

    const c = JSON.parse(await readFile(join(out, ".mp", "config.json"), "utf8"));
    c.agents.claude.env.FAKE_AGENT_SCENARIO = "ok";
    await writeFile(join(out, ".mp", "config.json"), JSON.stringify(c));
    const before = (await readFile(log, "utf8")).length;
    const r2 = await runScan({ yes: true });
    expect(r2.code).toBe(0);
    expect(r2.report!.created).toHaveLength(0);
    expect(r2.report!.judgement).toEqual({ judged: 1, unjudged: 0, skippedEdited: [] });
    const fresh = (await readFile(log, "utf8")).slice(before).trim().split("\n").map((l) => JSON.parse(l));
    const prompts = fresh.filter((o) => typeof o.text === "string");
    expect(prompts.filter((o) => o.text.includes("<<<FILE id="))).toHaveLength(0);
    expect(prompts.filter((o) => o.text.includes("<<<CARD id="))).toHaveLength(1);
    expect(fresh.filter((o) => "processCwd" in o).map((o) => o.model)).toEqual(["opus"]);
    expect(await readFile(join(out, "files", card), "utf8")).toMatch(/^value: (상|중|하)$/m);
  });

  it("asks before a judge-only run and never judges a card the user edited", async () => {
    const { out, src, log } = await setup("judge-rate-limit");
    await writeFile(join(src, "과제", "발표.md"), "발표 자료 정리. " + "본문 ".repeat(100));
    expect((await runScan({ yes: true })).report!.judgement!.unjudged).toBe(2);
    const c = JSON.parse(await readFile(join(out, ".mp", "config.json"), "utf8"));
    c.agents.claude.env.FAKE_AGENT_SCENARIO = "ok";
    await writeFile(join(out, ".mp", "config.json"), JSON.stringify(c));
    const [edited, other] = (await readdir(join(out, "files"))).sort();
    const p = join(out, "files", edited);
    const editedText = (await readFile(p, "utf8")).replace("상세", "사용자가 직접 고친 상세");
    await writeFile(p, editedText);

    // 판정만 남았을 때는 따로 묻는다. 거절하면 아무것도 보내지 않는다.
    const before = await readFile(log, "utf8");
    const asked: string[] = [];
    const declined = await runScan({ confirm: async (m) => { asked.push(m); return m.includes("보호") ? true : false; } });
    expect(asked.some((m) => /미판정 카드 1개를 claude로 판정/.test(m))).toBe(true);
    expect(await readFile(log, "utf8")).toBe(before);
    expect(declined.report!.judgement).toEqual({ judged: 0, unjudged: 2, skippedEdited: [`files/${edited}`] });

    const r = await runScan({ yes: true });
    expect(r.report!.judgement).toEqual({ judged: 1, unjudged: 1, skippedEdited: [`files/${edited}`] });
    expect(await readFile(p, "utf8")).toBe(editedText);
    expect(await readFile(join(out, "files", other), "utf8")).toMatch(/^value: (상|중|하)$/m);
    const reports = await readdir(join(out, "reports"));
    const texts = await Promise.all(reports.map((n) => readFile(join(out, "reports", n), "utf8")));
    expect(texts.some((t) => t.includes("## 편집된 카드라 판정 생략 (1)") && t.includes(edited))).toBe(true);
    const idx = await readFile(join(out, "index.md"), "utf8");
    expect(idx.split("\n").filter((l) => l.startsWith("| 미판정 |"))).toHaveLength(1);
  });

  it("judges unjudged cards from earlier scans before extracting (§9.6 다음 mp scan이 먼저 판정)", async () => {
    const { out, src, log } = await setup("judge-rate-limit");
    expect((await runScan({ yes: true })).report!.judgement!.unjudged).toBe(1);
    const [oldCard] = await readdir(join(out, "files"));
    await writeFile(join(src, "과제", "발표.md"), "발표 자료 정리. " + "본문 ".repeat(100));
    const c = JSON.parse(await readFile(join(out, ".mp", "config.json"), "utf8"));
    c.agents.claude.env.FAKE_AGENT_SCENARIO = "rate-limit-after-1";
    await writeFile(join(out, ".mp", "config.json"), JSON.stringify(c));
    await rm(join(out, "calls"), { force: true });
    const before = (await readFile(log, "utf8")).length;
    const { code, report } = await runScan({ yes: true });
    expect(code).toBe(3);
    const fresh = (await readFile(log, "utf8")).slice(before).trim().split("\n").map((l) => JSON.parse(l));
    const prompts = fresh.filter((o) => typeof o.text === "string" && !o.triage);
    expect(prompts[0].text).toContain("<<<CARD id=");
    expect(prompts[0].model).toBe("opus");
    expect(prompts[1].text).toContain("<<<FILE id=");
    expect(prompts).toHaveLength(2);
    expect(await readFile(join(out, "files", oldCard), "utf8")).toMatch(/^value: (상|중|하)$/m);
    expect(report!.created).toHaveLength(0);
    expect(report!.stoppedReason).toContain("사용량 한도");
    expect(report!.judgement).toEqual({ judged: 1, unjudged: 0, skippedEdited: [] });
  });

  it("stops the whole scan when the pre-extraction judge stage stops", async () => {
    const { out, src, log } = await setup("judge-rate-limit");
    await runScan({ yes: true });
    await writeFile(join(src, "과제", "발표.md"), "발표 자료 정리. " + "본문 ".repeat(100));
    const before = (await readFile(log, "utf8")).length;
    const { code, report } = await runScan({ yes: true });
    expect(code).toBe(3);
    expect(report!.stoppedReason).toContain("사용량 한도(판정 단계)");
    const fresh = (await readFile(log, "utf8")).slice(before).trim().split("\n").map((l) => JSON.parse(l));
    const prompts = fresh.filter((o) => typeof o.text === "string");
    expect(prompts.filter((o) => o.text.includes("<<<FILE id="))).toHaveLength(0);
    expect(prompts.filter((o) => o.text.includes("<<<CARD id="))).toHaveLength(1);
    expect(fresh.filter((o) => "processCwd" in o).map((o) => o.model)).toEqual(["opus"]);
    expect(report!.created).toHaveLength(0);
    expect(await readdir(join(out, "files"))).toHaveLength(1);
  });

  it("logs the judge batches actually sent, including after a restart", async () => {
    const { out } = await setup("judge-crash-once");
    const { code, report } = await runScan({ yes: true });
    expect(code).toBe(0);
    expect(report!.judgement).toEqual({ judged: 1, unjudged: 0, skippedEdited: [] });
    const logs = await readdir(join(out, ".mp", "logs"));
    const scanLog = await readFile(join(out, ".mp", "logs", logs.find((n) => n.startsWith("scan-"))!), "utf8");
    expect(scanLog).toMatch(/\[stage judge\] model=opus batches=2 prompts=2 chars=\d+/);
    expect(scanLog).toMatch(/\[stage extract\] model=haiku batches=1 prompts=1 /);
  });

  it("never sends generated outputs, meta files or tool folders, and counts them in the report (§9.7 B)", async () => {
    const { out, src, log } = await setup("ok");
    const body = "본문 ".repeat(100);
    await mkdir(join(src, "pages"));
    for (let i = 1; i <= 10; i++) await writeFile(join(src, "pages", `page-${String(i).padStart(4, "0")}.txt`), `PAGE-SPLIT ${body}`);
    await mkdir(join(src, "ghidra.rep", "idata"), { recursive: true });
    await writeFile(join(src, "ghidra.rep", "idata", "CMake.md"), `GHIDRA-REP ${body}`);
    await writeFile(join(src, "CMakeLists.txt"), `CMAKE-LISTS ${body}`);
    const { report } = await runScan({ yes: true });
    expect(report!.created).toHaveLength(1);
    expect(report!.generatedExcluded).toBe(12);
    const sent = await readFile(log, "utf8");
    for (const m of ["PAGE-SPLIT", "GHIDRA-REP", "CMAKE-LISTS"]) expect(sent).not.toContain(m);
    const [rep] = await readdir(join(out, "reports"));
    expect(await readFile(join(out, "reports", rep), "utf8")).toContain("생성물로 보여 제외 12개");
  });

  it("sends only head 3,500 + tail 500 chars of a long file, masked first (§9.7 C)", async () => {
    const { src, log } = await setup("ok");
    await writeFile(join(src, "과제", "긴보고서.md"), "HEAD-MARK " + "가".repeat(3600) + " MIDDLE-MARK " + "나".repeat(3000) + " 010-9876-5432 TAIL-MARK");
    const { report } = await runScan({ yes: true });
    expect(report!.created).toHaveLength(2);
    const sent = await readFile(log, "utf8");
    expect(sent).toContain("HEAD-MARK");
    expect(sent).toContain("TAIL-MARK");
    expect(sent).toContain("…(중략)…");
    expect(sent).not.toContain("MIDDLE-MARK");
    expect(sent).not.toContain("010-9876-5432");
    expect(sent).toContain("[전화번호] TAIL-MARK");
  });

  const readLog = async (log: string, from = 0) => (await readFile(log, "utf8")).slice(from).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const setScenario = async (out: string, scenario: string) => {
    const c = JSON.parse(await readFile(join(out, ".mp", "config.json"), "utf8"));
    c.agents.claude.env.FAKE_AGENT_SCENARIO = scenario;
    await writeFile(join(out, ".mp", "config.json"), JSON.stringify(c));
  };

  it("triage drops irrelevant files before extraction and remembers them (§9.7 E)", async () => {
    const { out, src, log } = await setup("triage-drop");
    const lecture = join(src, "과제", "외부문서.md");
    await writeFile(lecture, "DROP-ME 1주차 강의 슬라이드 원본. " + "본문 ".repeat(100) + "FAR-TEXT-BEYOND-HEAD " + "끝 ".repeat(200));
    const { code, report } = await runScan({ yes: true });
    expect(code).toBe(0);
    expect(report!.created).toHaveLength(1);
    expect(report!.skippedIrrelevant).toEqual([normalizePath(lecture)]);
    const lines = await readLog(log);
    const triage = lines.filter((o) => o.triage);
    expect(triage).toHaveLength(1);
    expect(triage[0].model).toBe("haiku");
    expect(triage[0].text).toContain("외부문서.md");
    expect(triage[0].text).not.toContain("FAR-TEXT-BEYOND-HEAD"); // 본문 앞 300자만
    expect(triage[0].text).not.toContain("010-1234-5678");
    const extract = lines.filter((o) => typeof o.text === "string" && o.text.includes("<<<FILE id="));
    expect(extract.some((o) => o.text.includes("DROP-ME"))).toBe(false);
    const state = JSON.parse(await readFile(join(out, ".mp", "state.json"), "utf8"));
    expect(state.files[normalizePath(lecture)].status).toBe("skipped_irrelevant");
    const [rep] = await readdir(join(out, "reports"));
    expect(await readFile(join(out, "reports", rep), "utf8")).toContain("## 선별 단계에서 제외 (1)");
    const logs = await readdir(join(out, ".mp", "logs"));
    const scanLog = await readFile(join(out, ".mp", "logs", logs.find((n) => n.startsWith("scan-"))!), "utf8");
    expect(scanLog).toMatch(/\[stage triage\] model=haiku batches=1 prompts=1 chars=\d+/);

    // 다음 스캔: 같은 파일·같은 내용의 사본 모두 다시 보내지 않는다
    const copy = join(src, "외부문서 - 복사본.md");
    await copyFile(lecture, copy);
    let before = (await readFile(log, "utf8")).length;
    const r2 = await runScan({ yes: true });
    expect(await readLog(log, before)).toEqual([]);
    expect(r2.report!.skippedIrrelevant).toEqual([normalizePath(copy)]);

    // --retriage: 다시 선별한다. 이번에는 keep되어 카드가 생긴다.
    await setScenario(out, "ok");
    before = (await readFile(log, "utf8")).length;
    const r3 = await runScan({ yes: true, retriage: true });
    expect(r3.report!.created).toHaveLength(1);
    expect((await readLog(log, before)).filter((o) => o.triage)).toHaveLength(1);
  });

  it("--no-triage skips the triage stage", async () => {
    const { log } = await setup("triage-drop");
    const { report } = await runScan({ yes: true, triage: false });
    expect(report!.created).toHaveLength(1);
    const lines = await readLog(log);
    expect(lines.filter((o) => o.triage)).toHaveLength(0);
    // 폴더 범위(5.5)는 --no-triage와 무관하게 실행된다
    expect(lines.filter((o) => "processCwd" in o).map((o) => o.model)).toEqual(["haiku", "haiku", "opus"]);
  });

  it("parses --no-triage and --retriage on the CLI", async () => {
    const { out, src, log } = await setup("triage-drop");
    await writeFile(join(src, "과제", "외부문서.md"), "DROP-ME 강의 원본. " + "본문 ".repeat(100));
    expect(await main(["node", "mp", "scan", "--yes"])).toBe(0);
    const state = JSON.parse(await readFile(join(out, ".mp", "state.json"), "utf8"));
    expect(Object.values(state.files).map((e: any) => e.status)).toContain("skipped_irrelevant");
    const before = (await readFile(log, "utf8")).length;
    expect(await main(["node", "mp", "scan", "--yes", "--no-triage", "--retriage"])).toBe(0);
    const fresh = await readLog(log, before);
    expect(fresh.filter((o) => o.triage)).toHaveLength(0);
    expect(fresh.some((o) => typeof o.text === "string" && o.text.includes("DROP-ME"))).toBe(true);
  });

  it("keeps every file when the triage reply cannot be parsed", async () => {
    const { log } = await setup("triage-garbage");
    const { code, report } = await runScan({ yes: true });
    expect(code).toBe(0);
    expect(report!.created).toHaveLength(1);
    expect(report!.skippedIrrelevant).toEqual([]);
    // 본 요청 + 같은 세션 재요청
    expect((await readLog(log)).filter((o) => o.triage)).toHaveLength(2);
  });

  it("stops the scan on a triage rate limit without extracting or judging; the next scan resumes", async () => {
    const { out, log } = await setup("triage-rate-limit");
    const { code, report } = await runScan({ yes: true });
    expect(code).toBe(3);
    expect(report!.stoppedReason).toContain("사용량 한도(선별 단계)");
    expect(report!.created).toHaveLength(0);
    const lines = await readLog(log);
    expect(lines.filter((o) => "processCwd" in o).map((o) => o.model)).toEqual(["haiku", "haiku"]);
    expect(lines.some((o) => typeof o.text === "string" && o.text.includes("<<<FILE id="))).toBe(false);
    await setScenario(out, "ok");
    const r2 = await runScan({ yes: true });
    expect(r2.code).toBe(0);
    expect(r2.report!.created).toHaveLength(1);
  });

  it("restarts the triage agent once after a crash", async () => {
    const { log } = await setup("triage-crash-once");
    const { code, report } = await runScan({ yes: true });
    expect(code).toBe(0);
    expect(report!.created).toHaveLength(1);
    expect((await readLog(log)).filter((o) => "processCwd" in o).map((o) => o.model)).toEqual(["haiku", "haiku", "haiku", "haiku", "opus"]);
  });

  const setUtil = async (out: string, env: Record<string, string>, opts: { scopeDone?: boolean } = { scopeDone: true }) => {
    const c = JSON.parse(await readFile(join(out, ".mp", "config.json"), "utf8"));
    // 기본: 폴더 범위 판단을 미리 넣어 두어 범위 단계 없이 선별·추출·판정의 예산만 본다
    if (opts.scopeDone) for (const root of c.scanFolders) c.scope = { decisions: { [normalizePath(join(root, "과제"))]: { decision: "include", by: "user", at: "t" } } };
    c.agents.claude.env = { ...c.agents.claude.env, FAKE_AGENT_UTIL_FILE: join(out, "util"), ...env };
    c.limits.batchChars = 100; // 파일마다 배치 하나
    await writeFile(join(out, ".mp", "config.json"), JSON.stringify(c));
  };
  const scanLogText = async (out: string) => {
    const logs = (await readdir(join(out, ".mp", "logs"))).filter((n) => n.startsWith("scan-"));
    return (await Promise.all(logs.map((n) => readFile(join(out, ".mp", "logs", n), "utf8")))).join("\n");
  };

  it("stops at the five-hour budget shared by all stages and resumes on the next run (§9.8)", async () => {
    const { out, src, log } = await setup("ok");
    for (const n of ["발표", "메모", "기획"]) await writeFile(join(src, "과제", `${n}.md`), `${n} 자료 정리. ` + "본문 ".repeat(100));
    // 프롬프트마다 사용률 +12%p. 첫 값(선별) 0.22 → 추출 0.34, 0.46, 0.58(+36%p) → 넷째 배치 전에 멈춤
    await setUtil(out, { FAKE_AGENT_UTIL_START: "0.10", FAKE_AGENT_UTIL_STEP: "0.12" });
    const r1 = await runScan({ yes: true });
    expect(r1.code).toBe(3);
    expect(r1.report!.created).toHaveLength(3);
    expect(r1.report!.stoppedReason).toMatch(/^사용량 예산 도달 — 사용 36%p, 카드 3개 생성, 남은 파일 1개, 창 리셋 \d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
    const lines = await readLog(log);
    // 판정은 같은 예산을 쓰므로 하지 않는다
    expect(lines.filter((o) => "processCwd" in o).map((o) => o.model)).toEqual(["haiku", "haiku"]);
    expect(r1.report!.judgement!.unjudged).toBe(3);
    expect(r1.report!.usage!.fiveHour).toEqual({ start: 0.22, last: 0.58, spent: 0.36, resetsAt: 1795507800 });
    expect(r1.report!.usage!.tokens.extract.cachedReadTokens).toBe(21);
    const log1 = await scanLogText(out);
    expect(log1).toMatch(/\[usage\] stage=extract tokens\(in\/out\/cr\/cw\)=\d+\/\d+\/7\/3 five_hour=0\.58 spent=0\.36/);
    const reports = await readdir(join(out, "reports"));
    const rep1 = await readFile(join(out, "reports", reports[0]), "utf8");
    expect(rep1).toContain("## 사용량");
    expect(rep1).toContain("5시간 사용률: 22% → 58% (이번 실행 +36%p, 예산 30%p)");

    // 창이 리셋된 뒤 다음 실행: 미판정 카드 판정 → 남은 파일 추출 → 판정
    await rm(join(out, "util"));
    await setUtil(out, { FAKE_AGENT_UTIL_START: "0", FAKE_AGENT_UTIL_STEP: "0.01" });
    const r2 = await runScan({ yes: true });
    expect(r2.code).toBe(0);
    expect(r2.report!.created).toHaveLength(1);
    expect(r2.report!.judgement).toEqual({ judged: 4, unjudged: 0, skippedEdited: [] });
  });

  it("planScale converts the Pro-based budget to the larger plan's window (§9.8)", async () => {
    const { out, src } = await setup("ok");
    for (const n of ["발표", "메모"]) await writeFile(join(src, "과제", `${n}.md`), `${n} 자료 정리. ` + "본문 ".repeat(100));
    const cfgPath = join(out, ".mp", "config.json");
    const cfg = JSON.parse(await readFile(cfgPath, "utf8")); cfg.budget = { fiveHourShare: 0.3, planScale: 5 };
    await writeFile(cfgPath, JSON.stringify(cfg));
    // 프롬프트마다 +4%p(실측). Pro 기준 30% = 실측 6%p → 둘째 추출 뒤(+8%p) 멈춤
    await setUtil(out, { FAKE_AGENT_UTIL_START: "0.10", FAKE_AGENT_UTIL_STEP: "0.04" });
    const r = await runScan({ yes: true });
    expect(r.code).toBe(3);
    expect(r.report!.stoppedReason).toContain("사용량 예산 도달 — 사용 40%p(Pro 기준, 실측 8%p)");
    const reports = await readdir(join(out, "reports"));
    expect(await readFile(join(out, "reports", reports[0]), "utf8")).toContain("Pro 기준(×5)");
  });

  it("--budget overrides the config share for one run", async () => {
    const { out, src } = await setup("ok");
    for (const n of ["발표", "메모"]) await writeFile(join(src, "과제", `${n}.md`), `${n} 자료 정리. ` + "본문 ".repeat(100));
    await setUtil(out, { FAKE_AGENT_UTIL_START: "0.10", FAKE_AGENT_UTIL_STEP: "0.12" });
    const r = await runScan({ yes: true, budget: 0.1 });
    expect(r.report!.created).toHaveLength(1);
    expect(r.report!.stoppedReason).toContain("사용량 예산 도달 — 사용 12%p");
  });

  it("asks before continuing when the window is already nearly used, and stops when declined (§9.8)", async () => {
    const { out, src } = await setup("ok");
    await writeFile(join(src, "과제", "발표.md"), "발표 자료 정리. " + "본문 ".repeat(100));
    await setUtil(out, { FAKE_AGENT_UTIL_START: "0.74", FAKE_AGENT_UTIL_STEP: "0.01" });
    const asked: string[] = [];
    const r = await runScan({ confirm: async (m) => { asked.push(m); return !m.includes("창 리셋"); } });
    expect(asked.some((m) => /5시간 사용량 창이 이미 75% 사용되었습니다\. 창 리셋\(.+\) 후 실행을 권장합니다/.test(m))).toBe(true);
    expect(r.code).toBe(3);
    expect(r.report!.created).toHaveLength(0);
    expect(r.report!.stoppedReason).toMatch(/^사용량이 이미 높아 중단 — 5시간 사용률 75%/);
  });

  it("does not enforce a budget without utilization info and logs that (§9.8)", async () => {
    const { out } = await setup("ok");
    const { code, report } = await runScan({ yes: true, budget: 0.01 });
    expect(code).toBe(0);
    expect(report!.usage!.fiveHour).toBeNull();
    expect(report!.usage!.tokens.extract.totalTokens).toBeGreaterThan(0);
    expect(await scanLogText(out)).toContain("사용률 정보 없음");
    const [rep] = await readdir(join(out, "reports"));
    expect(await readFile(join(out, "reports", rep), "utf8")).toContain("5시간 사용률: 정보 없음");
  });

  const addScopeFolders = async (src: string) => {
    for (const [d, n] of [["EXCL-설치", "설치안내.md"], ["ASK-모음", "자료.md"]]) {
      await mkdir(join(src, d), { recursive: true });
      await writeFile(join(src, d, n), `${d} 문서 UNIQUE-${d}. ` + "본문 ".repeat(100));
    }
  };

  it("runs the folder scope stage first, applies exclude decisions, and stores them for the next scan (§5.5)", async () => {
    const { out, src, log } = await setup("scope-mixed");
    await addScopeFolders(src);
    const asked: string[] = [];
    const { code, report } = await runScan({ yes: false, confirm: async () => true, askScope: async (f, q) => { asked.push(q); return "n"; } });
    expect(code).toBe(0);
    expect(asked).toEqual(["ASK-모음 폴더는 직접 만든 자료인가요?"]);
    expect(report!.scope).toMatchObject({ included: 1, excluded: 2, later: 0 });
    expect(report!.scope!.decided.map((d) => `${d.decision}:${d.by}`).sort()).toEqual(["exclude:llm", "exclude:user", "include:llm"]);
    const lines = await readLog(log);
    const scopeIdx = lines.findIndex((o) => o.scope);
    const triageIdx = lines.findIndex((o) => o.triage);
    expect(scopeIdx).toBeGreaterThanOrEqual(0);
    expect(scopeIdx).toBeLessThan(triageIdx);
    // 제외된 폴더의 파일은 선별·추출에 보내지 않는다
    const later = lines.filter((o) => !o.scope && typeof o.text === "string").map((o) => o.text).join("\n");
    expect(later).not.toContain("UNIQUE-EXCL");
    expect(later).not.toContain("UNIQUE-ASK");
    expect(report!.created).toHaveLength(1);
    const c = JSON.parse(await readFile(join(out, ".mp", "config.json"), "utf8"));
    expect(c.scope.decisions[normalizePath(join(src, "EXCL-설치"))]).toMatchObject({ decision: "exclude", by: "llm" });
    expect(c.scope.decisions[normalizePath(join(src, "ASK-모음"))]).toMatchObject({ decision: "exclude", by: "user" });
    const scanLog = await scanLogText(out);
    expect(scanLog).toMatch(/\[stage scope\] model=haiku batches=1 prompts=1 chars=\d+/);
    const [rep] = await readdir(join(out, "reports"));
    const repText = await readFile(join(out, "reports", rep), "utf8");
    expect(repText).toContain("폴더 범위: 포함 1, 제외 2, 나중에 0");
    expect(repText).toContain("## 이번에 새로 판단한 폴더 (3)");
    expect(repText).toContain(`- ${normalizePath(join(src, "EXCL-설치"))} — 제외 (LLM)`);
    // 다음 스캔: 판단 없는 폴더가 없으므로 범위 단계를 보내지 않는다
    const before = (await readFile(log, "utf8")).length;
    const r2 = await runScan({ yes: true });
    expect((await readLog(log, before)).filter((o) => o.scope)).toHaveLength(0);
    expect(r2.report!.scope).toBeUndefined();
  });

  it("--yes treats ask folders as later: included this run but not stored (§5.5)", async () => {
    const { out, src, log } = await setup("scope-mixed");
    await addScopeFolders(src);
    const { report } = await runScan({ yes: true, askScope: async () => "n" });
    expect(report!.scope).toMatchObject({ included: 1, excluded: 1, later: 1 });
    const sent = (await readLog(log)).filter((o) => o.triage).map((o) => o.text).join("\n");
    expect(sent).toContain("UNIQUE-ASK");
    const c = JSON.parse(await readFile(join(out, ".mp", "config.json"), "utf8"));
    expect(c.scope.decisions[normalizePath(join(src, "ASK-모음"))]).toBeUndefined();
  });

  it("stops the whole scan when the scope stage hits the rate limit; the next scan resumes (§5.5)", async () => {
    const { out, log } = await setup("scope-rate-limit");
    const { code, report } = await runScan({ yes: true });
    expect(code).toBe(3);
    expect(report!.stoppedReason).toContain("사용량 한도(범위 단계)");
    expect(report!.created).toHaveLength(0);
    const lines = await readLog(log);
    expect(lines.filter((o) => "processCwd" in o)).toHaveLength(1);
    expect(lines.some((o) => o.triage || o.call)).toBe(false);
    await setScenario(out, "ok");
    const r2 = await runScan({ yes: true });
    expect(r2.code).toBe(0);
    expect(r2.report!.created).toHaveLength(1);
  });

  it("includes every folder this run when the scope reply cannot be parsed (§5.5)", async () => {
    const { out, log } = await setup("scope-garbage");
    const { code, report } = await runScan({ yes: true });
    expect(code).toBe(0);
    expect(report!.created).toHaveLength(1);
    expect(report!.scope).toMatchObject({ included: 0, excluded: 0, later: 1 });
    expect((await readLog(log)).filter((o) => o.scope)).toHaveLength(2); // 본 요청 + 재요청
    expect(JSON.parse(await readFile(join(out, ".mp", "config.json"), "utf8")).scope.decisions).toEqual({});
  });

  it("restarts the scope agent once after a crash", async () => {
    const { log } = await setup("scope-crash-once");
    const { code, report } = await runScan({ yes: true });
    expect(code).toBe(0);
    expect(report!.created).toHaveLength(1);
    expect((await readLog(log)).filter((o) => "processCwd" in o).map((o) => o.model)).toEqual(["haiku", "haiku", "haiku", "haiku", "opus"]);
  });

  it("the scope stage shares the five-hour budget with the other stages (§5.5, §9.8)", async () => {
    const { out } = await setup("ok");
    await setUtil(out, { FAKE_AGENT_UTIL_START: "0.10", FAKE_AGENT_UTIL_STEP: "0.12" }, { scopeDone: false });
    // 범위 0.22(기준값) → 선별 0.34(+12%p ≥ 10%p) → 추출 전에 멈춤
    const r = await runScan({ yes: true, budget: 0.1 });
    expect(r.code).toBe(3);
    expect(r.report!.created).toHaveLength(0);
    expect(r.report!.stoppedReason).toContain("사용량 예산 도달 — 사용 12%p");
    expect(r.report!.usage!.tokens.scope.totalTokens).toBeGreaterThan(0);
    expect(await scanLogText(out)).toMatch(/\[usage\] stage=scope tokens/);
  });

  it("asks before sending folder names and includes everything this run when declined", async () => {
    const { out, log } = await setup("ok");
    const asked: string[] = [];
    const { report } = await runScan({ confirm: async (m) => { asked.push(m); return !m.includes("범위"); } });
    expect(asked[0]).toMatch(/판단이 없는 폴더 1개의 범위를 claude로 정리합니다/);
    expect((await readLog(log)).filter((o) => o.scope)).toHaveLength(0);
    expect(report!.created).toHaveLength(1);
    expect(report!.scope).toMatchObject({ included: 0, excluded: 0, later: 1 });
    expect(JSON.parse(await readFile(join(out, ".mp", "config.json"), "utf8")).scope.decisions).toEqual({});
  });

  it("rejects an out-of-range --budget", async () => {
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    for (const v of ["0", "1.5", "abc", "-0.2"]) expect(await main(["node", "mp", "scan", "--budget", v])).not.toBe(0);
    expect(err.mock.calls.join("")).toContain("1 이하");
  });

  it("rejects a non-positive or non-integer --limit", async () => {
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    for (const v of ["0", "-1", "1.5", "abc"]) {
      expect(await main(["node", "mp", "scan", "--limit", v])).not.toBe(0);
    }
    expect(err.mock.calls.join("")).toContain("1 이상의 정수");
  });
});

describe("runInit --non-interactive", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    delete process.env.MP_OUTPUT_DIR; delete process.env.MP_POINTER_FILE; delete process.env.MP_ALLOW_TEST_AGENTS;
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  it("rejects agents outside V1_AGENTS unless MP_ALLOW_TEST_AGENTS=1, and stores an absolute output", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const d = await mkTmp("mp-init-"); dirs.push(d);
    delete process.env.MP_OUTPUT_DIR;
    process.env.MP_POINTER_FILE = join(d, "pointer.json");
    const out = join(d, "out");
    expect(await runInit({ nonInteractive: true, agent: "fake", output: relative(process.cwd(), out) })).toBe(2);
    expect(err).toHaveBeenCalled();
    await expect(readFile(join(out, ".mp", "config.json"))).rejects.toThrow();
    process.env.MP_ALLOW_TEST_AGENTS = "1";
    expect(await runInit({ nonInteractive: true, agent: "fake", output: relative(process.cwd(), out) })).toBe(0);
    expect(JSON.parse(await readFile(join(d, "pointer.json"), "utf8")).outputDir).toBe(out);
    expect(JSON.parse(await readFile(join(out, ".mp", "config.json"), "utf8")).agent).toBe("fake");
  });

  it("stores scan folders as absolute paths with quotes stripped and ~ expanded, and warns when the output is inside one", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const d = await mkTmp("mp-init-"); dirs.push(d);
    delete process.env.MP_OUTPUT_DIR;
    process.env.MP_POINTER_FILE = join(d, "pointer.json");
    const docs = join(d, "Documents");
    const out = join(docs, "MasterPortfolio");
    const rel = relative(process.cwd(), join(d, "rel"));
    // 실제 폴더(~/Downloads)·에이전트를 건드리지 않도록 범위 단계는 가짜로 바꾼다
    const runScope = vi.fn(async () => 0);
    expect(await runInit({ nonInteractive: true, agent: "claude", output: `"${out}"`, folders: [`"${docs}"`, ` '${rel}' `, "~/Downloads", "  "], runScope })).toBe(0);
    expect(runScope).toHaveBeenCalledWith({ yes: true, outputDir: out });
    const c = JSON.parse(await readFile(join(out, ".mp", "config.json"), "utf8"));
    expect(c.scanFolders).toEqual([docs, join(d, "rel"), join(homedir(), "Downloads")]);
    expect(log.mock.calls.flat().join("\n")).toContain(`결과 폴더(${out})가 스캔 폴더(${docs}) 안에 있습니다`);
  });

  it("runs the folder scope step at the end as --yes, returns its code, and skips it with --no-scope (§5.5)", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const d = await mkTmp("mp-init-"); dirs.push(d);
    process.env.MP_POINTER_FILE = join(d, "pointer.json");
    const out = join(d, "out"); const docs = join(d, "Docs");
    await mkdir(docs);
    const runScope = vi.fn(async () => 3);
    expect(await runInit({ nonInteractive: true, agent: "claude", output: out, folders: [docs], runScope })).toBe(3);
    expect(runScope).toHaveBeenCalledWith({ yes: true, outputDir: out });
    runScope.mockClear();
    expect(await runInit({ nonInteractive: true, agent: "claude", output: out, folders: [docs], runScope, scope: false })).toBe(0);
    expect(await runInit({ nonInteractive: true, agent: "claude", output: out, folders: [], runScope })).toBe(0);
    expect(runScope).not.toHaveBeenCalled();
    expect(await runInit({ nonInteractive: true, agent: "claude", output: out, folders: [], runScope, planScale: 5 })).toBe(0);
    expect(JSON.parse(await readFile(join(out, ".mp", "config.json"), "utf8")).budget.planScale).toBe(5);
  });

  it("normalizeFolderInput handles ~, ~\\, quotes and blanks", () => {
    expect(normalizeFolderInput("~", "/h")).toBe(resolve("/h"));
    expect(normalizeFolderInput("~/a", "/h")).toBe(resolve("/h/a"));
    expect(normalizeFolderInput("~\\a", "/h")).toBe(resolve("/h", "a"));
    expect(normalizeFolderInput(' "/x/y" ', "/h")).toBe(resolve("/x/y"));
    expect(normalizeFolderInput("''", "/h")).toBeNull();
    expect(normalizeFolderInput("   ", "/h")).toBeNull();
    expect(normalizeFolderInput("~user/a", "/h")).toBe(resolve("~user/a"));
  });
});
