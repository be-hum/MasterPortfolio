import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, timingSafeEqual } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { AddressInfo } from "node:net";
import { z } from "zod";
import { CATEGORIES, CONTRIBUTIONS, KEYWORD_LIMITS, REVIEW_STATES, type ExperienceFrontmatter, type State } from "../core/schema.js";
import { CORRUPT_STATE_MSG, loadState } from "../store/state.js";
import { acceptExperienceEdit, listExperiences, saveExperience, type LoadedExperience } from "../store/experiences.js";
import { decideReview, recordAnswer } from "../review/session.js";
import { clampKeywords } from "../analyzer/keywords.js";
import { buildUiState, loadFileTitles } from "./model.js";
import { suggestFolders, defaultOutputDir } from "../setup/folders.js";
import { createSetupConfig, normalizeFolderInput, validateSetup, SetupError } from "../setup/config.js";
import { pathKey } from "../core/paths.js";
import { checkEnvironment, probeAgent, type AgentProbe } from "../setup/check.js";
import { pickFolder, PickUnavailable } from "../setup/pickFolder.js";
import { expandUniversity } from "../discovery/universities.js";
import { resetScopeDecisions } from "../discovery/scopeDecisions.js";
import { loadConfig, saveConfig } from "../config/config.js";
import { killTree, spawnGroupOptions } from "./killTree.js";
import { CHAIN, PROGRESS_PREFIX, SUMMARY_PREFIX, chainProgress, etaSeconds, overallProgress, type ProgressEvent } from "../core/progress.js";

export type SetupDeps = {
  suggest?: typeof suggestFolders; pick?: typeof pickFolder; check?: typeof checkEnvironment;
  create?: typeof createSetupConfig; defaultOutput?: () => Promise<string>;
  /** 화면을 열 때 알릴 새 폴더(기본: Windows에서 WSL 홈 안의 자료 폴더) */
  folderHints?: (keywords: string[]) => Promise<FolderHint[]>;
  /** 에이전트(Claude) 연결·로그인 확인 */
  probe?: (config: Awaited<ReturnType<typeof loadConfig>>) => Promise<AgentProbe>;
};
export type FolderHint = { path: string; label: string; kind?: string };
/** 화면을 열 때 알릴 폴더: 클라우드(OneDrive 등)·다른 드라이브·WSL. 이름 검색(느림)은 하지 않는다 */
async function defaultFolderHints(keywords: string[]): Promise<FolderHint[]> {
  if (process.platform !== "win32" && process.platform !== "darwin") return [];
  const all = await suggestFolders(keywords, { candidates: async () => [] });
  return all.filter((f) => f.kind === "cloud" || f.kind === "drive" || f.kind === "wsl").map(({ path, label, kind }) => ({ path, label, kind }));
}
/** out이 null이면 설정 모드: 처음 설정 API만 열려 있다 */
export type UiServerOptions = { out: string | null; port?: number; token: string; cliPath: string; html: (token: string) => string; onShutdown?: () => void; setupDeps?: SetupDeps };
export type JobProgress = { stage: string; done: number; total: number; overall: number | null; etaSec: number | null };
export type JobState = { kind: string; running: boolean; code: number | null; lines: string[]; progress: JobProgress | null;
  /** 완료 요약: 작업이 보낸 @@summary, 없으면 마지막 표준 출력 줄 */
  summary: string | null;
  /** 사용자가 [중지]를 눌렀음(끝날 때까지 running은 true) */
  stopped: boolean;
  /** [한 번에 정리]: 지금 몇 번째 작업인지 */
  step: { index: number; count: number; kind: string } | null };

const MAX_BODY = 1024 * 1024;
const MAX_DRAIN = 64 * 1024 * 1024;
const MAX_LINES = 200;
const STEP_LABEL: Record<string, string> = { scan: "스캔", group: "묶기", apply: "반영", keywords: "키워드", master: "master" };
const JOBS: Record<string, string[]> = {
  scan: ["scan", "--yes"],
  group: ["group", "--yes"],
  apply: ["review", "--apply-only", "--yes"],
  keywords: ["keywords", "--yes"],
  master: ["master"],
};
const UiEdit = z.object({
  title: z.string().min(1).max(120), period: z.string().nullable(), org: z.string().nullable(), role: z.string().nullable(),
  team_size: z.number().int().positive().nullable(),
  contribution: z.enum(CONTRIBUTIONS).nullable(), category: z.enum(CATEGORIES).nullable(),
  keywords: z.array(z.string()), outcome_keywords: z.array(z.string()), skills: z.array(z.string()), metrics: z.array(z.string()),
}).partial().strict();

class HttpError extends Error { constructor(public status: number, msg: string, public extra: Record<string, unknown> = {}) { super(msg); } }

const digest = (s: string) => createHash("sha256").update(s).digest();
/** 길이가 달라도 안전하게 비교하려고 해시한 뒤 timingSafeEqual */
const sameToken = (a: unknown, b: string) => typeof a === "string" && timingSafeEqual(digest(a), digest(b));

function send(res: ServerResponse, status: number, body: unknown, type = "application/json; charset=utf-8") {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(text);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  let size = 0; const chunks: Buffer[] = []; let over = Number(req.headers["content-length"] ?? 0) > MAX_BODY;
  await new Promise<void>((ok, fail) => {
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) over = true;
      if (!over) chunks.push(c);
      else if (size > MAX_DRAIN) { req.destroy(); fail(new HttpError(413, "본문이 너무 큽니다(최대 1MB).")); }
    });
    req.on("end", ok);
    req.on("error", fail);
  });
  if (over) throw new HttpError(413, "본문이 너무 큽니다(최대 1MB).");
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
  catch { throw new HttpError(400, "JSON 형식이 아닙니다."); }
}

const obj = (b: unknown): Record<string, unknown> => {
  if (!b || typeof b !== "object" || Array.isArray(b)) throw new HttpError(400, "요청 형식이 올바르지 않습니다.");
  return b as Record<string, unknown>;
};

export async function startUiServer(o: UiServerOptions): Promise<{ url: string; port: number; close(): Promise<void> }> {
  const { token } = o;
  let out: string | null = o.out;
  const sd = o.setupDeps ?? {};
  let picking = false;
  const needSetup = () => new HttpError(409, "처음 설정이 필요합니다.");
  const cur = (): string => { if (out === null) throw needSetup(); return out; };
  let port = 0;
  let job: { kind: string; running: boolean; code: number | null; lines: string[]; child: ChildProcess | null; progress: ProgressEvent | null; startedAt: number; maxOverall: number; summary: string | null; lastOut: string | null; stopped: boolean; step: number; stepKinds: string[]; stepSummaries: string[] } | null = null;
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => { const r = chain.then(fn, fn); chain = r.catch(() => {}); return r; };
  const jobState = (): JobState | null => {
    if (!job) return null;
    const p = job.progress;
    const chain = job.stepKinds.length > 1;
    const raw = chain ? chainProgress(job.step, p) : p ? overallProgress(job.kind, p) : null;
    // 범위 정리 뒤 파일을 다시 찾는 등 앞 단계로 돌아가도 전체 %는 뒤로 가지 않는다
    if (raw !== null) job.maxOverall = Math.max(job.maxOverall, raw);
    const overall = raw === null ? null : job.maxOverall;
    return {
      kind: job.kind, running: job.running, code: job.code, lines: [...job.lines], stopped: job.stopped,
      summary: job.running ? null : job.stopped ? "사용자가 중지함 — 이미 만든 카드는 저장되어 있고, 다음 실행에서 이어서 처리합니다"
        : chain ? job.stepSummaries.join(" / ") || null : (job.summary ?? job.lastOut),
      progress: p || chain ? { ...(p ?? { stage: job.stepKinds[job.step] ?? job.kind, done: 0, total: 0 }), overall, etaSec: job.running ? etaSeconds(overall, Date.now() - job.startedAt) : null } : null,
      step: chain ? { index: job.step, count: job.stepKinds.length, kind: job.stepKinds[Math.min(job.step, job.stepKinds.length - 1)] } : null,
    };
  };

  async function fresh(): Promise<{ state: State; exps: LoadedExperience[] }> {
    const dir = cur();
    const { state, problem } = await loadState(dir);
    if (problem === "corrupt") throw new HttpError(500, CORRUPT_STATE_MSG);
    return { state, exps: await listExperiences(dir, state) };
  }
  const find = (exps: LoadedExperience[], rel: unknown) => {
    const e = typeof rel === "string" ? exps.find((x) => x.rel === rel) : undefined;
    if (!e) throw new HttpError(404, "경험 카드를 찾을 수 없습니다.");
    return e;
  };
  const editedErr = () => new HttpError(409, "바깥에서 편집됨 — 받아들이기 후 다시 시도하세요.");
  const write = async (state: State, e: LoadedExperience, fm: ExperienceFrontmatter) => {
    if ("skipped" in (await saveExperience(cur(), state, e, fm))) throw editedErr();
  };

  function startJob(kind: string) {
    const outDir = cur();
    if (job?.running) throw new HttpError(409, "이미 작업이 실행 중입니다.");
    const stepKinds = kind === "all" ? CHAIN.map(([k]) => k) : [kind];
    if (!stepKinds.every((k) => JOBS[k])) throw new HttpError(400, "알 수 없는 작업입니다.");
    const j = { kind, running: true, code: null as number | null, lines: [] as string[], child: null as ChildProcess | null, progress: null as ProgressEvent | null, startedAt: Date.now(), maxOverall: 0, summary: null as string | null, lastOut: null as string | null, stopped: false,
      step: 0, stepKinds, stepSummaries: [] as string[] };
    job = j;
    const push = (l: string, fromStdout = false) => {
      if (l.startsWith(SUMMARY_PREFIX)) { j.summary = l.slice(SUMMARY_PREFIX.length).trim() || null; return; }
      // 진행률 줄(@@progress {...})은 로그에 넣지 않고 상태로만 쓴다
      if (l.startsWith(PROGRESS_PREFIX)) {
        try { const ev = JSON.parse(l.slice(PROGRESS_PREFIX.length)) as ProgressEvent; if (typeof ev.stage === "string" && Number.isFinite(ev.done) && Number.isFinite(ev.total)) j.progress = ev; } catch { /* 무시 */ }
        return;
      }
      if (fromStdout && l.trim()) j.lastOut = l.trim();
      j.lines.push(l); if (j.lines.length > MAX_LINES) j.lines.splice(0, j.lines.length - MAX_LINES);
    };
    const finish = (code: number | null) => { j.running = false; j.code = code ?? 1; j.child = null; };
    // 연쇄 작업은 앞 작업이 성공해야 다음으로 간다(실패·예산 중단·[중지]면 거기서 멈춤)
    const runStep = () => {
      const k = j.stepKinds[j.step];
      if (j.stepKinds.length > 1) push(`── ${j.step + 1}/${j.stepKinds.length} ${STEP_LABEL[k] ?? k} ──`);
      j.summary = null; j.lastOut = null; j.progress = null;
      const child = spawn(process.execPath, [o.cliPath, ...JOBS[k]], { cwd: process.cwd(), env: { ...process.env, MP_OUTPUT_DIR: outDir, MP_PROGRESS: "1" }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, ...spawnGroupOptions() });
      j.child = child;
      for (const st of [child.stdout!, child.stderr!]) {
        let buf = "";
        const isOut = st === child.stdout;
        st.setEncoding("utf8");
        st.on("data", (d: string) => { buf += d; const parts = buf.split(/\r?\n/); buf = parts.pop()!; for (const l of parts) push(l, isOut); });
        st.on("end", () => { if (buf) push(buf, isOut); buf = ""; });
      }
      let done = false;
      const end = (code: number | null) => {
        if (done) return; done = true;
        if (j.stepKinds.length > 1) {
          const sum = j.summary ?? j.lastOut;
          j.stepSummaries.push(`${STEP_LABEL[k] ?? k}: ${code === 0 ? sum ?? "완료" : `실패(코드 ${code ?? 1})${sum ? " " + sum : ""}`}`);
        }
        if (code === 0 && !j.stopped && j.step + 1 < j.stepKinds.length) { j.step++; runStep(); return; }
        if (code === 0) j.step = j.stepKinds.length;
        finish(code);
      };
      child.on("error", (e) => { push(`실행 실패: ${e.message}`); end(1); });
      child.on("close", (code) => end(code));
    };
    runStep();
  }

  // 새 폴더 제안: 서버를 띄운 뒤 한 번만 찾는다(WSL 접근은 느리고 배포판을 깨울 수 있음)
  let hintCache: Promise<FolderHint[]> | null = null;
  const hints = (keywords: string[]) => {
    if (!hintCache) {
      const f = sd.folderHints ?? defaultFolderHints;
      hintCache = f(keywords).catch(() => []);
    }
    return hintCache;
  };
  /** \\wsl$\ 와 \\wsl.localhost\ 는 같은 곳 */
  const hintKey = (p: string) => pathKey(p.replace(/^\\\\wsl\$\\/i, "\\\\wsl.localhost\\"));
  const newHints = (list: FolderHint[], c: { scanFolders: string[]; dismissedFolders: string[] }) => {
    const have = new Set([...c.scanFolders, ...c.dismissedFolders].map(hintKey));
    return list.filter((h) => !have.has(hintKey(h.path)));
  };

  // 에이전트 연결 확인: 화면을 열 때 한 번(실패했으면 [다시 확인]으로 다시). 작업 중에는 확인하지 않는다
  let probeCache: Promise<AgentProbe> | null = null;

  const SETUP_OPEN = new Set(["/api/setup", "/api/setup/suggest", "/api/pick-folder", "/api/check", "/api/shutdown"]);
  const busyErr = () => new HttpError(409, "작업 실행 중에는 수정할 수 없습니다. 끝난 뒤 다시 시도하세요.");

  async function settingsPost(b: Record<string, unknown>, dir: string) {
    if (job?.running) throw busyErr();
    const c = await loadConfig(dir);
    if (b.scanFolders !== undefined) {
      if (!Array.isArray(b.scanFolders) || !b.scanFolders.every((x) => typeof x === "string")) throw new HttpError(400, "scanFolders는 문자열 목록이어야 합니다.");
      // 이미 설정에 있던 폴더는 다시 검사하지 않는다(예: WSL이 꺼져 있으면 \\wsl.localhost 폴더가 일시적으로 안 보임). 새로 추가한 폴더만 엄격히 검사
      const known = new Set(c.scanFolders.map((f) => pathKey(f)));
      const list = b.scanFolders as string[];
      const added = list.filter((f) => { const n = normalizeFolderInput(f); return !!n && !known.has(pathKey(n)); });
      const kept = c.scanFolders.filter((f) => list.some((x) => { const n = normalizeFolderInput(x); return !!n && pathKey(n) === pathKey(f); }));
      if (!kept.length && !added.length) throw new HttpError(400, "스캔할 폴더를 하나 이상 고르세요");
      let addedOk: string[] = [];
      if (added.length) {
        const v = await validateSetup({ university: c.university.input, keywords: c.university.keywords, folders: added, planScale: 1, output: dir });
        if (!v.ok) throw new HttpError(400, v.errors[0], { errors: v.errors });
        addedOk = v.folders;
      }
      c.scanFolders = [...kept, ...addedOk.filter((f) => !kept.some((k) => pathKey(k) === pathKey(f)))];
    }
    if (b.planScale !== undefined) {
      if (![1, 5, 20].includes(b.planScale as number)) throw new HttpError(400, "요금제 배수는 1, 5, 20 중 하나여야 합니다");
      c.budget.planScale = b.planScale as number;
    }
    if (b.fiveHourShare !== undefined) {
      const f = b.fiveHourShare;
      if (typeof f !== "number" || !Number.isFinite(f) || f < 0.05 || f > 1) throw new HttpError(400, "5시간 사용 비율은 0.05~1 사이여야 합니다.");
      c.budget.fiveHourShare = f;
    }
    if (b.keywords !== undefined) {
      if (!Array.isArray(b.keywords) || !b.keywords.every((x) => typeof x === "string")) throw new HttpError(400, "keywords는 문자열 목록이어야 합니다.");
      c.university.keywords = [...new Set((b.keywords as string[]).map((x) => x.trim()).filter(Boolean))];
    }
    await saveConfig(dir, c);
  }

  async function api(req: IncomingMessage, res: ServerResponse, path: string, method: string) {
    if (out === null && !SETUP_OPEN.has(path)) {
      if (path === "/api/state" && method === "GET") return send(res, 200, { ok: true, setup: true });
      throw needSetup();
    }
    if (path === "/api/state" && method === "GET") {
      const dir = cur();
      const { state, exps } = await fresh();
      return send(res, 200, { ok: true, experiences: buildUiState(exps, await loadFileTitles(dir, exps)), job: jobState(), output: dir, lastScan: state.last_scan });
    }
    if (path === "/api/job" && method === "GET") return send(res, 200, { ok: true, job: jobState() });
    if (path === "/api/setup/suggest" && method === "GET") {
      const university = new URL(req.url ?? "/", "http://localhost").searchParams.get("university") ?? "";
      const keywords = expandUniversity(university);
      const [folders, defaultOutput] = await Promise.all([(sd.suggest ?? suggestFolders)(keywords), (sd.defaultOutput ?? defaultOutputDir)()]);
      return send(res, 200, { ok: true, keywords, folders, defaultOutput });
    }
    if (path === "/api/folder-hints" && method === "GET") {
      const c = await loadConfig(cur());
      return send(res, 200, { ok: true, folders: newHints(await hints(c.university.keywords), c) });
    }
    if (path === "/api/agent-status" && method === "GET") {
      const dir = cur();
      const refresh = new URL(req.url ?? "/", "http://localhost").searchParams.get("refresh") === "1";
      if (job?.running && !probeCache) return send(res, 200, { ok: true, agent: null });
      if (!probeCache || refresh) {
        const c = await loadConfig(dir);
        probeCache = (sd.probe ?? probeAgent)(c).catch((e) => ({ ok: false as const, kind: "crash", label: e instanceof Error ? e.message : String(e), fix: "" }));
      }
      return send(res, 200, { ok: true, agent: await probeCache });
    }
    if (path === "/api/settings" && method === "GET") {
      const dir = cur();
      const c = await loadConfig(dir);
      return send(res, 200, { ok: true, output: dir, university: c.university.input, keywords: c.university.keywords, scanFolders: c.scanFolders,
        planScale: c.budget.planScale, fiveHourShare: c.budget.fiveHourShare,
        scope: Object.entries(c.scope.decisions).map(([p, d]) => ({ path: p, decision: d.decision, by: d.by, at: d.at })) });
    }
    if (method !== "POST") throw new HttpError(404, "없는 경로입니다.");
    const b = obj(await readBody(req));
    if (path === "/api/check") {
      const skipAgent = b.skipAgent === true;
      return send(res, 200, { ok: true, items: await (sd.check ?? checkEnvironment)(out, { skipAgent }) });
    }
    if (path === "/api/pick-folder") {
      if (picking) throw new HttpError(409, "폴더 선택 창이 이미 열려 있습니다.");
      picking = true;
      try {
        const initial = typeof b.initial === "string" && b.initial ? b.initial : undefined;
        const title = typeof b.title === "string" && b.title ? b.title : undefined;
        let p: string | null;
        try { p = await (sd.pick ?? pickFolder)({ initial, title }); }
        catch (e) { if (e instanceof PickUnavailable) throw new HttpError(400, e.message); throw e; }
        if (p !== null && !(await stat(p).then((x) => x.isDirectory(), () => false))) throw new HttpError(400, `폴더가 아닙니다: ${p}`);
        return send(res, 200, { ok: true, path: p });
      } finally { picking = false; }
    }
    if (path === "/api/setup") return serial(async () => {
      if (out !== null) throw new HttpError(409, "이미 설정되어 있습니다.");
      const input = {
        university: typeof b.university === "string" ? b.university : "",
        keywords: Array.isArray(b.keywords) ? b.keywords.filter((x): x is string => typeof x === "string") : [],
        folders: Array.isArray(b.folders) ? b.folders.filter((x): x is string => typeof x === "string") : [],
        planScale: typeof b.planScale === "number" ? b.planScale : 1,
        output: typeof b.output === "string" ? b.output : "",
      };
      try {
        const r = await (sd.create ?? createSetupConfig)(input, { adoptExisting: b.adopt === true });
        const dismissed = Array.isArray(b.dismissed) ? b.dismissed.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];
        if (dismissed.length) {
          const c = await loadConfig(r.output);
          const have = new Set(c.dismissedFolders.map(hintKey));
          c.dismissedFolders.push(...dismissed.filter((p) => !have.has(hintKey(p))));
          await saveConfig(r.output, c);
        }
        out = r.output;
        return send(res, 200, { ok: true, output: r.output });
      } catch (e) {
        if (e instanceof SetupError && e.existing) throw new HttpError(409, e.errors[0], { errors: e.errors, existing: e.existing });
        if (e instanceof SetupError) throw new HttpError(400, e.errors[0] ?? "설정 값이 올바르지 않습니다.", { errors: e.errors });
        throw e;
      }
    });
    // 작업 시작도 쓰기와 같은 직렬 큐에서: 앞선 UI 쓰기가 끝난 뒤에 자식이 state.json을 읽게 한다
    if (path === "/api/shutdown") {
      if (job?.running) throw new HttpError(409, "작업 실행 중에는 종료할 수 없습니다. 끝난 뒤 다시 시도하세요.");
      send(res, 200, { ok: true });
      setTimeout(() => o.onShutdown?.(), 50);
      return;
    }
    if (path === "/api/settings") return serial(async () => { await settingsPost(b, cur()); send(res, 200, { ok: true }); });
    if (path === "/api/settings/scope-reset") return serial(async () => {
      const dir = cur();
      if (job?.running) throw busyErr();
      const raw = typeof b.path === "string" ? normalizeFolderInput(b.path) : null;
      if (!raw) throw new HttpError(400, "path가 필요합니다.");
      const c = await loadConfig(dir);
      const removed = resetScopeDecisions(c.scope.decisions, raw);
      if (removed.length) await saveConfig(dir, c);
      send(res, 200, { ok: true, removed: removed.length });
    });
    // 새 폴더 제안에 답하기: add는 스캔 폴더에 넣고, dismiss는 다시 묻지 않는다. 이번에 제안한 폴더만 받는다
    if (path === "/api/folder-hints") return serial(async () => {
      const dir = cur();
      if (job?.running) throw busyErr();
      const pick = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
      const c = await loadConfig(dir);
      const offered = new Map(newHints(await hints(c.university.keywords), c).map((h) => [hintKey(h.path), h.path]));
      const add = pick(b.add).map((p) => offered.get(hintKey(p))).filter((p): p is string => !!p);
      const dismiss = pick(b.dismiss).map((p) => offered.get(hintKey(p))).filter((p): p is string => !!p);
      if (!add.length && !dismiss.length) throw new HttpError(400, "처리할 제안 폴더가 없습니다.");
      c.scanFolders.push(...add);
      c.dismissedFolders.push(...dismiss.filter((p) => !add.includes(p)));
      await saveConfig(dir, c);
      send(res, 200, { ok: true, added: add.length, dismissed: dismiss.length });
    });
    if (path === "/api/job") return serial(async () => { startJob(String(b.kind)); send(res, 200, { ok: true, job: jobState() }); });
    // 중지: 작업과 에이전트 프로세스 트리를 끝낸다. 끝날 때(close)까지는 계속 실행 중으로 보고 쓰기는 409
    if (path === "/api/job/stop") {
      if (!job?.running || !job.child) throw new HttpError(409, "실행 중인 작업이 없습니다.");
      job.stopped = true; killTree(job.child);
      return send(res, 200, { ok: true, job: jobState() });
    }
    // 작업(자식 프로세스)이 카드를 쓰는 동안에는 UI 쓰기를 막는다(서로의 저장이 편집으로 오인되지 않게)
    return serial(async () => {
      // 큐에서 기다리는 동안 작업이 시작됐을 수 있으므로 실행 직전에 검사한다
      if (job?.running) throw busyErr();
      const { state, exps } = await fresh();
      if (path === "/api/decide") {
        const d = z.enum(REVIEW_STATES).safeParse(b.decision);
        if (!d.success || d.data === "pending" || !Array.isArray(b.rels) || !b.rels.every((r) => typeof r === "string")) throw new HttpError(400, "rels와 decision(adopted|held|excluded)이 필요합니다.");
        const targets = (b.rels as string[]).map((r) => find(exps, r));
        const edited: string[] = [], saved: string[] = [];
        for (const e of targets) {
          if (e.edited) { edited.push(e.rel); continue; }
          if ("skipped" in (await saveExperience(cur(), state, e, decideReview(e.fm, d.data)))) edited.push(e.rel); else saved.push(e.rel);
        }
        if (edited.length) return send(res, 409, { error: "바깥에서 편집된 카드가 있어 건너뛰었습니다.", edited, saved });
        return send(res, 200, { ok: true, saved });
      }
      if (path === "/api/answer") {
        const e = find(exps, b.rel);
        if (e.edited) throw editedErr();
        if (typeof b.a !== "string") throw new HttpError(400, "답변(a)이 필요합니다.");
        if (!e.fm.questions.some((q) => q.id === b.qid)) throw new HttpError(404, "질문을 찾을 수 없습니다.");
        const next = recordAnswer(e.fm, b.qid as string, b.a);
        if (next !== e.fm) await write(state, e, next);
        return send(res, 200, { ok: true });
      }
      if (path === "/api/edit") {
        const e = find(exps, b.rel);
        if (e.edited) throw editedErr();
        const p = UiEdit.safeParse(b.fields);
        if (!p.success) throw new HttpError(400, "허용되지 않는 필드이거나 값이 올바르지 않습니다.");
        const f = p.data;
        const list = (a: string[]) => a.map((s) => s.trim()).filter(Boolean);
        const nul = (s: string | null) => (s === null ? null : s.trim() || null);
        const fm: ExperienceFrontmatter = { ...e.fm };
        if (f.title !== undefined) { const t = f.title.trim(); if (!t) throw new HttpError(400, "제목이 비어 있습니다."); fm.title = t; }
        if (f.period !== undefined) fm.period = nul(f.period);
        if (f.org !== undefined) fm.org = nul(f.org);
        if (f.role !== undefined) fm.role = nul(f.role);
        if (f.team_size !== undefined) fm.team_size = f.team_size;
        if (f.contribution !== undefined) fm.contribution = f.contribution;
        if (f.category !== undefined) fm.category = f.category;
        if (f.keywords) fm.keywords = clampKeywords(f.keywords, KEYWORD_LIMITS.keywords);
        if (f.outcome_keywords) fm.outcome_keywords = clampKeywords(f.outcome_keywords, KEYWORD_LIMITS.outcome);
        if (f.skills) fm.skills = list(f.skills);
        if (f.metrics) fm.metrics = list(f.metrics);
        await write(state, e, fm);
        return send(res, 200, { ok: true });
      }
      if (path === "/api/accept-edit") {
        const e = find(exps, b.rel);
        if (e.edited) await acceptExperienceEdit(cur(), state, e);
        return send(res, 200, { ok: true });
      }
      throw new HttpError(404, "없는 경로입니다.");
    });
  }

  async function serveFile(res: ServerResponse, rawPath: string) {
    let rel: string;
    try { rel = decodeURIComponent(rawPath.slice("/files/".length)); } catch { throw new HttpError(404, "파일을 찾을 수 없습니다."); }
    const root = resolve(cur());
    const target = resolve(root, rel);
    const within = (t: string, r: string) => [resolve(r, "files") + sep, resolve(r, "experiences") + sep].some((d) => t.startsWith(d));
    if (rel.includes("\0") || !target.endsWith(".md") || !within(target, root)) throw new HttpError(404, "파일을 찾을 수 없습니다.");
    try {
      const real = await realpath(target);
      if (!within(real, await realpath(root)) || !(await stat(real)).isFile()) throw new Error("x");
      return send(res, 200, await readFile(real, "utf8"), "text/plain; charset=utf-8");
    } catch { throw new HttpError(404, "파일을 찾을 수 없습니다."); }
  }

  const server = createServer((req, res) => {
    (async () => {
      const host = req.headers.host;
      if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) throw new HttpError(403, "허용되지 않는 Host입니다.");
      const method = req.method ?? "GET";
      const rawPath = (req.url ?? "/").split("?")[0];
      if (rawPath === "/" || rawPath === "/index.html") {
        if (method !== "GET") throw new HttpError(405, "허용되지 않는 메서드입니다.");
        const t = new URL(req.url ?? "/", "http://localhost").searchParams.get("t");
        if (!sameToken(t, token)) throw new HttpError(401, "토큰이 올바르지 않습니다. `mp ui`가 출력한 주소로 접속하세요.");
        return send(res, 200, o.html(token), "text/html; charset=utf-8");
      }
      if (rawPath.startsWith("/api/") || rawPath.startsWith("/files/")) {
        if (!sameToken(req.headers["x-mp-token"], token)) throw new HttpError(401, "토큰이 올바르지 않습니다.");
        if (rawPath.startsWith("/api/")) return api(req, res, rawPath, method);
        if (method !== "GET") throw new HttpError(405, "허용되지 않는 메서드입니다.");
        return serveFile(res, rawPath);
      }
      throw new HttpError(404, "없는 경로입니다.");
    })().catch((e) => {
      if (res.headersSent) { res.end(); return; }
      if (e instanceof HttpError) send(res, e.status, { error: e.message, ...e.extra });
      else send(res, 500, { error: `서버 오류: ${e instanceof Error ? e.message : String(e)}` });
    });
  });

  await new Promise<void>((ok, fail) => { server.once("error", fail); server.listen(o.port ?? 0, "127.0.0.1", ok); });
  port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/?t=${token}`, port,
    close: () => new Promise<void>((ok) => {
      if (job?.child) killTree(job.child);
      server.close(() => ok());
      server.closeAllConnections();
    }),
  };
}
