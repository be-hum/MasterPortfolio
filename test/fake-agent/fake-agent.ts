import * as acp from "@agentclientprotocol/sdk";
import { Readable, Writable } from "node:stream";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const scenario = process.env.FAKE_AGENT_SCENARIO ?? "ok";
const logFile = process.env.FAKE_AGENT_LOG;
const stateFile = process.env.FAKE_AGENT_STATE;
const utilFile = process.env.FAKE_AGENT_UTIL_FILE;
const log = (o: unknown) => { if (logFile) appendFileSync(logFile, JSON.stringify(o) + "\n"); };

function nextCall(): number {
  if (!stateFile) return 1;
  let n = 0; try { n = Number(readFileSync(stateFile, "utf8")) || 0; } catch { /* first */ }
  writeFileSync(stateFile, String(n + 1)); return n + 1;
}

// 단계별 모델 확인용(스펙 9.6): 어댑터는 env ANTHROPIC_MODEL로 모델을 받는다
const model = process.env.ANTHROPIC_MODEL ?? null;

/** 2단계(판정) 프롬프트면 카드 id 목록, 아니면 null */
function judgeIds(prompt: string): string[] | null {
  const ids = [...prompt.matchAll(/^<<<CARD id=(\S+)/gm)].map((m) => m[1]);
  if (ids.length) return ids;
  const retry = prompt.match(/다음 카드 id들에 대해서만[^:]*: (.+)$/m);
  return retry ? retry[1].split(",").map((x) => x.trim()).filter(Boolean) : null;
}

/** 0단계(선별) 프롬프트면 파일 id → 블록 본문(재요청이면 빈 문자열), 아니면 null. 표식은 src/analyzer/triage.ts TRIAGE_MARKER */
function triageBlocks(prompt: string): Map<string, string> | null {
  if (!prompt.startsWith("[선별 단계]")) return null;
  const blocks = new Map<string, string>();
  for (const m of prompt.matchAll(/^<<<TRIAGE id=(\S+) nonce=\w+>>>\n([\s\S]*?)\n<<<END nonce=/gm)) blocks.set(m[1], m[2]);
  const retry = prompt.match(/다음 id들 중 keep할 id만[^:]*: (.+)$/m);
  if (!blocks.size && retry) for (const id of retry[1].split(",").map((x) => x.trim()).filter(Boolean)) blocks.set(id, "");
  return blocks;
}

/** 폴더 범위 단계(5.5) 프롬프트면 폴더 id → 경로(재요청이면 빈 문자열), 아니면 null. 표식은 src/analyzer/scope.ts SCOPE_MARKER */
function scopeBlocks(prompt: string): Map<string, string> | null {
  if (!prompt.startsWith("[범위 단계]")) return null;
  const blocks = new Map<string, string>();
  for (const m of prompt.matchAll(/^<<<SCOPE id=(\S+) nonce=\w+>>>\npath: (.*)$/gm)) blocks.set(m[1], m[2]);
  const retry = prompt.match(/다음 폴더 id들에 대해서만[^:]*: (.+)$/m);
  if (!blocks.size && retry) for (const id of retry[1].split(",").map((x) => x.trim()).filter(Boolean)) blocks.set(id, "");
  return blocks;
}

const VALUES = ["상", "중", "하"];

function answerFor(prompt: string): string {
  const jids = judgeIds(prompt);
  if (jids) return JSON.stringify(jids.map((id, i) => ({ id, value: VALUES[i % 3], value_reason: `판정 근거 ${id}` })));
  let ids = [...prompt.matchAll(/^(?:<<<FILE|### FILE) id=(\S+)/gm)].map((m) => m[1]);
  const retry = prompt.match(/다음 id들에 대해서만[^:]*: (.+)$/m);
  if (!ids.length && retry) ids = retry[1].split(",").map((x) => x.trim()).filter(Boolean);
  return JSON.stringify(ids.map((id) => ({
    id, type: "보고서", use_for: ["포트폴리오"], title: `제목 ${id}`, summary: "요약", detail: "상세",
    excerpts: ["발췌"], period: "2025-03 ~ 2025-06", role: null, skills: ["Python"], metrics: [],
    org: null, in_resume: "판단불가",
  })));
}

let sessions = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const cancelWaiters = new Map<string, () => void>();
log({ processCwd: process.cwd(), model });

acp.agent({ name: "fake-agent" })
  .onRequest(acp.methods.agent.initialize, async () => {
    // hang-initialize: initialize에 영원히 답하지 않는다
    if (scenario === "hang-initialize") await new Promise(() => {});
    return { protocolVersion: acp.PROTOCOL_VERSION, agentCapabilities: { loadSession: false }, authMethods: [] };
  })
  .onRequest(acp.methods.agent.session.new, async ({ params }) => {
    log({ sessionNew: { cwd: params.cwd, _meta: params._meta ?? null } });
    // hang-session-new: session/new에 영원히 답하지 않는다
    if (scenario === "hang-session-new") await new Promise(() => {});
    if (scenario === "auth-on-new") throw acp.RequestError.authRequired();
    return { sessionId: `s${++sessions}` };
  })
  .onRequest(acp.methods.agent.session.setMode, ({ params }) => { log({ setMode: params.modeId }); return {}; })
  .onNotification(acp.methods.agent.session.cancel, ({ params }) => { log({ cancel: params.sessionId }); cancelWaiters.get(params.sessionId)?.(); })
  .onRequest(acp.methods.agent.session.prompt, async ({ params, client }) => {
    const text = params.prompt.map((b) => (b.type === "text" ? b.text : "")).join("");
    const say = async (reply: string) => {
      // 5시간 사용률(스펙 9.8): FAKE_AGENT_UTIL_FILE이 있으면 프롬프트마다 FAKE_AGENT_UTIL_STEP만큼 올려
      // claude-agent-acp처럼 usage_update(_meta["_claude/rateLimit"])로 알린다. 모델·비용만 담은 usage_update도 함께 보낸다.
      if (utilFile) {
        let u = Number(process.env.FAKE_AGENT_UTIL_START ?? "0");
        try { u = Number(readFileSync(utilFile, "utf8")); } catch { /* 처음 */ }
        u = Math.round((u + Number(process.env.FAKE_AGENT_UTIL_STEP ?? "0")) * 1000) / 1000;
        writeFileSync(utilFile, String(u));
        const resetsAt = Number(process.env.FAKE_AGENT_UTIL_RESETS_AT ?? "1795507800");
        await client.notify(acp.methods.client.session.update, {
          sessionId: params.sessionId, update: { sessionUpdate: "usage_update", used: 0, size: 200000, _meta: { "_claude/model": model ?? "fake" } },
        });
        await client.notify(acp.methods.client.session.update, {
          sessionId: params.sessionId,
          update: {
            sessionUpdate: "usage_update", used: 0, size: 200000,
            _meta: { "_claude/rateLimit": {
              status: "allowed", resetsAt, rateLimitType: "five_hour",
              unifiedWindows: { five_hour: { utilization: u, resetsAt, status: "allowed" }, seven_day: { utilization: 0.05, resetsAt: resetsAt + 86400, status: "allowed" } },
            } },
          },
        });
      }
      await client.notify(acp.methods.client.session.update, {
        sessionId: params.sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: reply } },
      });
      const usage = { inputTokens: text.length, outputTokens: reply.length, cachedReadTokens: 7, cachedWriteTokens: 3, totalTokens: text.length + reply.length + 10 };
      return { stopReason: "end_turn" as const, usage };
    };
    // 0단계(선별): 기본은 전부 keep. 호출 횟수(FAKE_AGENT_STATE)에 세지 않아 다른 시나리오의 call 번호는 그대로다.
    // triage-drop: 본문에 DROP-ME가 있는 파일을 drop / triage-garbage: JSON 없이 답함
    // triage-rate-limit: 사용량 한도 / triage-crash-once: 첫 선별 프롬프트에서 프로세스가 죽음(재시작 후 정상)
    // 폴더 범위 단계(5.5): 기본은 전부 include. 선별처럼 호출 횟수에 세지 않는다.
    // scope-mixed: 경로에 EXCL이 있으면 exclude, ASK가 있으면 ask(질문 포함) / scope-garbage: JSON 없이 답함
    // scope-rate-limit: 사용량 한도 / scope-crash-once: 첫 범위 프롬프트에서 프로세스가 죽음(재시작 후 정상)
    // scope-partial: 첫 응답에서 마지막 폴더를 빠뜨리고 재요청에는 답함
    const sb = scopeBlocks(text);
    if (sb) {
      log({ scope: true, text, model });
      if (scenario === "scope-rate-limit") throw new Error("Claude usage limit reached (429 rate limit)");
      if (scenario === "scope-crash-once" && stateFile) {
        const marker = stateFile + ".scope-crashed";
        if (!existsSync(marker)) { writeFileSync(marker, "1"); process.exit(1); }
      }
      if (scenario === "scope-garbage") return say("폴더를 판단할 수 없습니다.");
      let entries = [...sb];
      if (scenario === "scope-partial" && entries.every(([, p]) => p !== "")) entries = entries.slice(0, -1);
      return say(JSON.stringify(entries.map(([id, path]) =>
        scenario === "scope-mixed" && path.includes("EXCL") ? { id, decision: "exclude" }
          : scenario === "scope-mixed" && path.includes("ASK") ? { id, decision: "ask", q: `${path} 폴더는 직접 만든 자료인가요?` }
          : { id, decision: "include" })));
    }
    // 키워드 단계(11.5): 경험마다 고정 키워드. keywords-garbage: 첫 응답은 JSON 없이 답함. 호출 횟수에 세지 않는다.
    if (text.startsWith("[키워드 단계]")) {
      const ids = [...text.matchAll(/^<<<EXP id=(\S+) nonce=/gm)].map((m) => m[1]);
      const retry = text.match(/다음 경험 id들에 대해서만[^:]*: (.+)$/m);
      const all = ids.length ? ids : (retry?.[1].split(",").map((x) => x.trim()).filter(Boolean) ?? []);
      log({ stage: "keywords", model, text });
      if (scenario === "keywords-garbage") {
        const marker = (stateFile ?? "") + ".keywords-garbage";
        if (stateFile && !existsSync(marker)) { writeFileSync(marker, "1"); return say("모르겠습니다"); }
      }
      return say(JSON.stringify(all.map((id) => ({ id, keywords: ["경험 키워드"], outcome_keywords: ["성과 키워드"] }))));
    }
    // 질의응답 반영(11.2): 경험마다 STAR와 역할을 돌려준다. 호출 횟수에 세지 않는다.
    if (text.startsWith("[반영 단계]")) {
      if (scenario === "apply-rate-limit") throw new Error("Claude usage limit reached (429 rate limit)");
      const ids = [...text.matchAll(/^<<<EXP id=(\S+) nonce=/gm)].map((m) => m[1]);
      const retry = text.match(/다음 경험 id들에 대해서만[^:]*: (.+)$/m);
      const all = ids.length ? ids : (retry?.[1].split(",").map((x) => x.trim()).filter(Boolean) ?? []);
      log({ stage: "apply", model, text });
      const blockOf = (id: string) => text.match(new RegExp(`<<<EXP id=${id} nonce=\\w+>>>\\n([\\s\\S]*?)<<<END`))?.[1] ?? "";
      const fill = (id: string) => {
        const r: Record<string, unknown> = { id, keywords: ["반영 키워드"], outcome_keywords: ["반영 성과"], star: { s: "상황", t: "과제", a: "행동", r: "결과" } };
        for (const m of blockOf(id).matchAll(/^Q\[(\w+)\]: .*\nA: (.*)$/gm)) {
          const f = m[1], a = m[2].trim();
          if (!a || a === "모름") continue;
          if (f === "period" || f === "org" || f === "role") r[f] = a;
          else if (f === "team_size") { const n = a.match(/\d+/); if (n) r[f] = Number(n[0]); }
          else if (f === "metrics") r[f] = [a];
          else if (f === "skills") r[f] = a.split(",").map((x) => x.trim()).filter(Boolean);
          else if (f === "contribution") r[f] = a.includes("AI") && a.includes("대부분") ? "AI 주도" : a.includes("강의") ? "학습 후 재수행" : a.includes("개념") ? "개념 해석" : a.includes("AI") ? "AI 보조" : "직접 수행";
        }
        return r;
      };
      return say(JSON.stringify(all.map(fill)));
    }
    // 경험 묶기(11.1): 기본은 카드마다 새 경험 하나. 호출 횟수에 세지 않는다.
    if (text.startsWith("[묶기 단계]")) {
      if (scenario === "group-rate-limit") throw new Error("Claude usage limit reached (429 rate limit)");
      if (scenario === "group-garbage") return say("묶을 수 없습니다.");
      if (scenario === "group-crash-once" && stateFile) {
        const marker = stateFile + ".group-crashed";
        if (!existsSync(marker)) { writeFileSync(marker, "1"); process.exit(1); }
      }
      const cards = [...text.matchAll(/^<<<CARD id=(\S+) nonce=\w+>>>\n(.*)$/gm)].map((m) => ({ id: m[1], line: m[2] }));
      const retry = text.match(/다음 카드 id들에 대해서만[^:]*: (.+)$/m);
      const ids = cards.length ? cards.map((c) => c.id) : (retry?.[1].split(",").map((x) => x.trim()).filter(Boolean) ?? []);
      const hasExisting = /^<<<EXP id=e1 /m.test(text);
      const lineOf = (id: string) => cards.find((c) => c.id === id)?.line ?? "";
      const out = { experiences: [] as unknown[], attach: [] as unknown[], unassigned: [] as string[] };
      if (scenario === "group-one") {
        out.experiences.push({ title: "하나의 경험", type: "보고서", category: "프로젝트", evidence: ids, keywords: ["역분석", "입력 복원"], outcome_keywords: ["키 복원"], questions: [{ field: "period", q: "언제였나요?" }, { field: "role", q: "본인 역할은?" }, { field: "metrics", q: "정량 성과가 있나요?" }] });
      } else for (const id of ids) {
        if (lineOf(id).includes("UNASSIGN")) out.unassigned.push(id);
        else if (hasExisting && lineOf(id).includes("ATTACH")) out.attach.push({ card: id, experience: "e1", questions: [{ field: "metrics", q: "추가 성과는?" }] });
        else out.experiences.push({ title: `경험 ${id}`, type: "보고서", category: "프로젝트", keywords: [`경험 ${id} 활동`], outcome_keywords: [`경험 ${id} 성과`], evidence: [id],
          questions: scenario === "group-merge" ? [{ field: "role", q: "본인 역할은?" }, { field: "metrics", q: "정량 성과가 있나요?" }] : [{ field: "role", q: "본인 역할은?" }] });
      }
      log({ stage: "group", model, text });
      return say(JSON.stringify(out));
    }
    if (text.startsWith("[병합 단계]")) {
      const keys = [...text.matchAll(/^<<<EXP id=(\S+) /gm)].map((m) => m[1]);
      log({ stage: "merge", model, text });
      if (scenario === "group-merge-rate-limit") throw new Error("Claude usage limit reached (429 rate limit)");
      if (scenario === "group-merge-fail") process.exit(1);
      return say(JSON.stringify({ merge: scenario === "group-merge" && keys.length >= 2 ? [keys.slice(0, 2)] : [] }));
    }
    const tb = triageBlocks(text);
    if (tb) {
      log({ triage: true, text, model });
      if (scenario === "triage-rate-limit") throw new Error("Claude usage limit reached (429 rate limit)");
      if (scenario === "triage-crash-once" && stateFile) {
        const marker = stateFile + ".triage-crashed";
        if (!existsSync(marker)) { writeFileSync(marker, "1"); process.exit(1); }
      }
      if (scenario === "triage-garbage") return say("파일을 선별할 수 없습니다.");
      const keep = [...tb].filter(([, body]) => !(scenario === "triage-drop" && body.includes("DROP-ME"))).map(([id]) => id);
      return say(JSON.stringify({ keep }));
    }
    const call = nextCall();
    log({ call, text, model });
    // slow: 첫 턴은 cancel을 받은 뒤 잠시 후 늦은 청크를 보낸다. 이후 턴은 느리게 정상 응답.
    // hang: 첫 턴은 cancel을 받아도 끝나지 않는다.
    if ((scenario === "slow" || scenario === "hang") && call === 1) {
      await new Promise<void>((r) => cancelWaiters.set(params.sessionId, r));
      cancelWaiters.delete(params.sessionId);
      if (scenario === "hang") await new Promise(() => {});
      await sleep(200);
      await client.notify(acp.methods.client.session.update, {
        sessionId: params.sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "OLD_TURN_CHUNK" } },
      });
      return { stopReason: "cancelled" };
    }
    // crash-once: 첫 턴에서 프로세스가 죽는다(FAKE_AGENT_STATE로 재시작 후에는 정상).
    if (scenario === "crash-once" && call === 1) process.exit(1);
    if (scenario === "crash-always") process.exit(1);
    if (scenario === "slow") await sleep(500);
    if (scenario === "rate-limit-after-1" && call >= 2) throw new Error("Claude usage limit reached (429 rate limit)");
    // judge-crash-once: 첫 판정 프롬프트에서 프로세스가 죽는다(재시작 후 정상)
    if (scenario === "judge-crash-once" && judgeIds(text) && stateFile) {
      const marker = stateFile + ".judge-crashed";
      if (!existsSync(marker)) { writeFileSync(marker, "1"); process.exit(1); }
    }
    // judge-rate-limit: 추출은 정상, 판정 단계에서만 사용량 한도
    if (scenario === "judge-rate-limit" && judgeIds(text)) throw new Error("Claude usage limit reached (429 rate limit)");
    if (scenario === "permission") {
      const r = await client.request(acp.methods.client.session.requestPermission, {
        sessionId: params.sessionId,
        toolCall: { toolCallId: "t1", title: "Read /etc/passwd", kind: "read", status: "pending" },
        options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }, { optionId: "reject", name: "Reject", kind: "reject_once" }],
      });
      log({ permissionOutcome: r.outcome });
    }
    let reply = answerFor(text);
    if (scenario === "badjson-once" && call === 1) reply = "죄송합니다, JSON을 만들지 못했습니다.";
    // garbage: 설정·모델 오류처럼 JSON 없이 늘 같은 문장만 답한다
    if (scenario === "garbage") reply = "선택한 모델을 사용할 수 없습니다. 설정을 확인하세요.";
    if (scenario === "fenced") reply = "분석 결과입니다.\n```json\n" + reply + "\n```\n추가 설명은 없습니다.";
    if (scenario === "rate-limit-text-after-1" && call >= 2) reply = "You've hit your usage limit. Upgrade to Plus to continue using Codex.";
    return say(reply);
  })
  .connect(acp.ndJsonStream(Writable.toWeb(process.stdout) as WritableStream<Uint8Array>, Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>));
