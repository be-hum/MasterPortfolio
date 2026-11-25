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
import { PROGRESS_PREFIX, SUMMARY_PREFIX, etaSeconds, overallProgress, type ProgressEvent } from "../core/progress.js";

export type UiServerOptions = { out: string; port?: number; token: string; cliPath: string; html: (token: string) => string; onShutdown?: () => void };
export type JobProgress = { stage: string; done: number; total: number; overall: number | null; etaSec: number | null };
export type JobState = { kind: string; running: boolean; code: number | null; lines: string[]; progress: JobProgress | null;
  /** 완료 요약: 작업이 보낸 @@summary, 없으면 마지막 표준 출력 줄 */
  summary: string | null };

const MAX_BODY = 1024 * 1024;
const MAX_DRAIN = 64 * 1024 * 1024;
const MAX_LINES = 200;
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
  const { out, token } = o;
  let port = 0;
  let job: { kind: string; running: boolean; code: number | null; lines: string[]; child: ChildProcess | null; progress: ProgressEvent | null; startedAt: number; maxOverall: number; summary: string | null; lastOut: string | null } | null = null;
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => { const r = chain.then(fn, fn); chain = r.catch(() => {}); return r; };
  const jobState = (): JobState | null => {
    if (!job) return null;
    const p = job.progress;
    const raw = p ? overallProgress(job.kind, p) : null;
    // 범위 정리 뒤 파일을 다시 찾는 등 앞 단계로 돌아가도 전체 %는 뒤로 가지 않는다
    if (raw !== null) job.maxOverall = Math.max(job.maxOverall, raw);
    const overall = raw === null ? null : job.maxOverall;
    return {
      kind: job.kind, running: job.running, code: job.code, lines: [...job.lines],
      summary: job.running ? null : (job.summary ?? job.lastOut),
      progress: p ? { ...p, overall, etaSec: job.running ? etaSeconds(overall, Date.now() - job.startedAt) : null } : null,
    };
  };

  async function fresh(): Promise<{ state: State; exps: LoadedExperience[] }> {
    const { state, problem } = await loadState(out);
    if (problem === "corrupt") throw new HttpError(500, CORRUPT_STATE_MSG);
    return { state, exps: await listExperiences(out, state) };
  }
  const find = (exps: LoadedExperience[], rel: unknown) => {
    const e = typeof rel === "string" ? exps.find((x) => x.rel === rel) : undefined;
    if (!e) throw new HttpError(404, "경험 카드를 찾을 수 없습니다.");
    return e;
  };
  const editedErr = () => new HttpError(409, "바깥에서 편집됨 — 받아들이기 후 다시 시도하세요.");
  const write = async (state: State, e: LoadedExperience, fm: ExperienceFrontmatter) => {
    if ("skipped" in (await saveExperience(out, state, e, fm))) throw editedErr();
  };

  function startJob(kind: string) {
    if (job?.running) throw new HttpError(409, "이미 작업이 실행 중입니다.");
    const args = JOBS[kind];
    if (!args) throw new HttpError(400, "알 수 없는 작업입니다.");
    const j = { kind, running: true, code: null as number | null, lines: [] as string[], child: null as ChildProcess | null, progress: null as ProgressEvent | null, startedAt: Date.now(), maxOverall: 0, summary: null as string | null, lastOut: null as string | null };
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
    const child = spawn(process.execPath, [o.cliPath, ...args], { cwd: process.cwd(), env: { ...process.env, MP_OUTPUT_DIR: out, MP_PROGRESS: "1" }, stdio: ["ignore", "pipe", "pipe"] });
    j.child = child;
    for (const s of [child.stdout!, child.stderr!]) {
      let buf = "";
      const isOut = s === child.stdout;
      s.setEncoding("utf8");
      s.on("data", (d: string) => { buf += d; const parts = buf.split(/\r?\n/); buf = parts.pop()!; for (const l of parts) push(l, isOut); });
      s.on("end", () => { if (buf) push(buf, isOut); buf = ""; });
    }
    let done = false;
    const finish = (code: number | null) => { if (done) return; done = true; j.running = false; j.code = code ?? 1; j.child = null; };
    child.on("error", (e) => { push(`실행 실패: ${e.message}`); finish(1); });
    child.on("close", (code) => finish(code));
  }

  async function api(req: IncomingMessage, res: ServerResponse, path: string, method: string) {
    if (path === "/api/state" && method === "GET") {
      const { exps } = await fresh();
      return send(res, 200, { ok: true, experiences: buildUiState(exps, await loadFileTitles(out, exps)), job: jobState(), output: out });
    }
    if (path === "/api/job" && method === "GET") return send(res, 200, { ok: true, job: jobState() });
    if (method !== "POST") throw new HttpError(404, "없는 경로입니다.");
    const b = obj(await readBody(req));
    // 작업 시작도 쓰기와 같은 직렬 큐에서: 앞선 UI 쓰기가 끝난 뒤에 자식이 state.json을 읽게 한다
    if (path === "/api/shutdown") {
      if (job?.running) throw new HttpError(409, "작업 실행 중에는 종료할 수 없습니다. 끝난 뒤 다시 시도하세요.");
      send(res, 200, { ok: true });
      setTimeout(() => o.onShutdown?.(), 50);
      return;
    }
    if (path === "/api/job") return serial(async () => { startJob(String(b.kind)); send(res, 200, { ok: true, job: jobState() }); });
    // 작업(자식 프로세스)이 카드를 쓰는 동안에는 UI 쓰기를 막는다(서로의 저장이 편집으로 오인되지 않게)
    return serial(async () => {
      // 큐에서 기다리는 동안 작업이 시작됐을 수 있으므로 실행 직전에 검사한다
      if (job?.running) throw new HttpError(409, "작업 실행 중에는 수정할 수 없습니다. 끝난 뒤 다시 시도하세요.");
      const { state, exps } = await fresh();
      if (path === "/api/decide") {
        const d = z.enum(REVIEW_STATES).safeParse(b.decision);
        if (!d.success || d.data === "pending" || !Array.isArray(b.rels) || !b.rels.every((r) => typeof r === "string")) throw new HttpError(400, "rels와 decision(adopted|held|excluded)이 필요합니다.");
        const targets = (b.rels as string[]).map((r) => find(exps, r));
        const edited: string[] = [], saved: string[] = [];
        for (const e of targets) {
          if (e.edited) { edited.push(e.rel); continue; }
          if ("skipped" in (await saveExperience(out, state, e, decideReview(e.fm, d.data)))) edited.push(e.rel); else saved.push(e.rel);
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
        if (e.edited) await acceptExperienceEdit(out, state, e);
        return send(res, 200, { ok: true });
      }
      throw new HttpError(404, "없는 경로입니다.");
    });
  }

  async function serveFile(res: ServerResponse, rawPath: string) {
    let rel: string;
    try { rel = decodeURIComponent(rawPath.slice("/files/".length)); } catch { throw new HttpError(404, "파일을 찾을 수 없습니다."); }
    const root = resolve(out);
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
      job?.child?.kill();
      server.close(() => ok());
      server.closeAllConnections();
    }),
  };
}
