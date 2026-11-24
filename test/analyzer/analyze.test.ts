import { describe, it, expect } from "vitest";
import { analyzeBatches } from "../../src/analyzer/analyze.js";
import { AgentError, type AgentReply } from "../../src/agent/bridge.js";

const ok = (id: string) => ({
  id, type: "기타", use_for: [], title: "t", summary: "s", detail: "d", excerpts: [], period: null, role: null,
  skills: [], metrics: [], org: null, in_resume: "판단불가",
});
const item = (id: string) => ({ id, relPath: id as any, format: "md", modified: "2025-01-01", text: "본문" as any });
const idsIn = (t: string) => [...t.matchAll(/^(?:<<<FILE|### FILE) id=(\S+)/gm)].map((m) => m[1]);

function fakeBridge(replies: ((prompt: string) => AgentReply)[]) {
  let i = 0, sessions = 0;
  return {
    sessionsOpened: () => sessions,
    newSession: async () => `s${++sessions}`,
    prompt: async (_s: string, t: string) => replies[Math.min(i++, replies.length - 1)](t),
  };
}

describe("analyzeBatches", () => {
  it("retries once for missing ids, then marks them failed", async () => {
    const results: string[] = [], failed: string[] = [];
    const b = fakeBridge([
      () => ({ ok: true, text: JSON.stringify([ok("a")]) }),
      () => ({ ok: true, text: "여전히 실패" }),
    ]);
    const r = await analyzeBatches(b, [[item("a"), item("b")]], {
      timeoutMs: 1000, baselineSummary: null,
      onResult: async (id) => { results.push(id); }, onFailed: async (id) => { failed.push(id); },
    });
    expect(r.stopped).toBeNull();
    expect(results).toEqual(["a"]);
    expect(failed).toEqual(["b"]);
  });

  it("stops on rate limit and leaves remaining batches untouched", async () => {
    const results: string[] = [];
    const b = fakeBridge([
      (t) => ({ ok: true, text: JSON.stringify(idsIn(t).map(ok)) }),
      () => ({ ok: false, kind: "rate_limit", detail: "429" }),
    ]);
    const r = await analyzeBatches(b, [[item("a")], [item("b")], [item("c")]], {
      timeoutMs: 1000, baselineSummary: null,
      onResult: async (id) => { results.push(id); }, onFailed: async () => {},
    });
    expect(r.stopped?.kind).toBe("rate_limit");
    expect(results).toEqual(["a"]);
  });

  it("opens a fresh session for every batch; the retry stays in that batch's session (§9.7 A)", async () => {
    const seen: [string, string][] = [];
    let n = 0, sessions = 0;
    const b = {
      newSession: async () => `s${++sessions}`,
      // 첫 배치의 첫 응답은 b0 누락 → 같은 세션에서 재요청
      prompt: async (s: string, t: string) => {
        seen.push([s, t]); n++;
        const ids = n === 1 ? [] : idsIn(t).length ? idsIn(t) : ["f0"];
        return { ok: true as const, text: JSON.stringify(ids.map(ok)) };
      },
    };
    await analyzeBatches(b, Array.from({ length: 6 }, (_, i) => [item(`f${i}`)]), {
      timeoutMs: 1000, baselineSummary: null, onResult: async () => {}, onFailed: async () => {},
    });
    expect(sessions).toBe(6);
    expect(seen.map(([s]) => s)).toEqual(["s1", "s1", "s2", "s3", "s4", "s5", "s6"]);
  });

  it("stops when a non-JSON reply is a usage-limit message (Codex style)", async () => {
    const results: string[] = [];
    const b = fakeBridge([
      (t) => ({ ok: true, text: JSON.stringify(idsIn(t).map(ok)) }),
      () => ({ ok: true, text: "You've hit your usage limit. Upgrade to Plus to continue using Codex." }),
    ]);
    const r = await analyzeBatches(b, [[item("a")], [item("b")]], {
      timeoutMs: 1000, baselineSummary: null,
      onResult: async (id) => { results.push(id); }, onFailed: async () => {},
    });
    expect(r.stopped?.kind).toBe("rate_limit");
    expect(results).toEqual(["a"]);
  });

  it("stops with auth when opening a session fails with AgentError(auth)", async () => {
    const b = { newSession: async () => { throw new AgentError("auth", "Authentication required"); }, prompt: async () => ({ ok: true as const, text: "[]" }) };
    const r = await analyzeBatches(b, [[item("a")]], {
      timeoutMs: 1000, baselineSummary: null, onResult: async () => {}, onFailed: async () => {},
    });
    expect(r.stopped).toEqual({ kind: "auth", detail: "Authentication required" });
  });

  it("timeout marks the batch failed and continues", async () => {
    const results: string[] = [], failed: string[] = [];
    const b = fakeBridge([
      () => ({ ok: false, kind: "timeout", detail: "t" }),
      (t) => ({ ok: true, text: JSON.stringify(idsIn(t).map(ok)) }),
    ]);
    const r = await analyzeBatches(b, [[item("a")], [item("b")]], {
      timeoutMs: 1000, baselineSummary: null,
      onResult: async (id) => { results.push(id); }, onFailed: async (id) => { failed.push(id); },
    });
    expect(r.stopped).toBeNull();
    expect(failed).toEqual(["a"]);
    expect(results).toEqual(["b"]);
  });
});

describe("analyzeBatches service-message guard", () => {
  it("does not stop on a truncated JSON reply mentioning rate limit; item fails after retry", async () => {
    const failed: string[] = [];
    const b = fakeBridge([() => ({ ok: true, text: '[{"id":"a","summary":"API rate limit 429 처리' })]);
    const r = await analyzeBatches(b, [[item("a")]], {
      timeoutMs: 1000, baselineSummary: null, onResult: async () => {}, onFailed: async (id) => { failed.push(id); },
    });
    expect(r.stopped).toBeNull();
    expect(failed).toEqual(["a"]);
  });
  it("uses a fixed detail, not the reply text", async () => {
    const msg = "You've hit your usage limit. Upgrade to Plus to continue using Codex.";
    const b = fakeBridge([() => ({ ok: true, text: msg })]);
    const r = await analyzeBatches(b, [[item("a")]], {
      timeoutMs: 1000, baselineSummary: null, onResult: async () => {}, onFailed: async () => {},
    });
    expect(r.stopped?.kind).toBe("rate_limit");
    expect(r.stopped?.detail).not.toContain("Upgrade");
  });
});

describe("analyzeBatches circuit breaker", () => {
  const opts = (results: string[], failed: string[], extra: object = {}) => ({
    timeoutMs: 1000, baselineSummary: null,
    onResult: async (id: string) => { results.push(id); }, onFailed: async (id: string) => { failed.push(id); }, ...extra,
  });

  it("stops with no_results after 2 consecutive batches without a JSON array and leaves them unprocessed", async () => {
    const results: string[] = [], failed: string[] = [];
    const b = fakeBridge([() => ({ ok: true, text: "모델을 찾을 수 없습니다." })]);
    const r = await analyzeBatches(b, [[item("a")], [item("b")], [item("c")]], opts(results, failed));
    expect(r.stopped).toEqual({ kind: "no_results", detail: "에이전트가 연속으로 분석 결과를 돌려주지 않았습니다 (설정·모델 오류 가능). 스캔 로그를 확인하세요." });
    expect(results).toEqual([]);
    expect(failed).toEqual([]);
  });

  it("a single unparseable batch followed by a good one marks only the first as failed", async () => {
    const results: string[] = [], failed: string[] = [];
    let n = 0;
    const b = fakeBridge([(t) => (++n <= 2 ? { ok: true, text: "죄송합니다" } : { ok: true, text: JSON.stringify(idsIn(t).map(ok)) })]);
    const r = await analyzeBatches(b, [[item("a")], [item("b")]], opts(results, failed));
    expect(r.stopped).toBeNull();
    expect(failed).toEqual(["a"]);
    expect(results).toEqual(["b"]);
  });

  it("does not trip when the reply had a JSON array but every item was invalid", async () => {
    const results: string[] = [], failed: string[] = [];
    const b = fakeBridge([() => ({ ok: true, text: '[{"id":"x"}]' })]);
    const r = await analyzeBatches(b, [[item("a")], [item("b")], [item("c")]], opts(results, failed));
    expect(r.stopped).toBeNull();
    expect(failed).toEqual(["a", "b", "c"]);
  });

  it("reports unparseable replies through onUnparsed", async () => {
    const seen: string[] = [];
    const b = fakeBridge([() => ({ ok: true, text: "설명만 있는 답변" })]);
    await analyzeBatches(b, [[item("a")]], opts([], [], { onUnparsed: (t: string) => seen.push(t) }));
    expect(seen).toEqual(["설명만 있는 답변", "설명만 있는 답변"]);
  });
});

describe("analyzeBatches session/new timeout", () => {
  it("maps AgentError(timeout) from newSession to a crash stop", async () => {
    const b = { newSession: async () => { throw new AgentError("timeout", "에이전트가 session/new에 60초 안에 응답하지 않음"); }, prompt: async () => ({ ok: true as const, text: "[]" }) };
    const r = await analyzeBatches(b, [[item("a")]], {
      timeoutMs: 1000, baselineSummary: null, onResult: async () => {}, onFailed: async () => {},
    });
    expect(r.stopped).toEqual({ kind: "crash", detail: "에이전트가 session/new에 60초 안에 응답하지 않음" });
  });
});

describe("runBatches budget hooks (§9.8)", () => {
  it("checks before every batch and stops without sending once it returns a Stop", async () => {
    let sent = 0;
    const usages: unknown[] = [];
    const b = { newSession: async () => "s", prompt: async (_s: string, t: string) => { sent++; return { ok: true as const, text: JSON.stringify(idsIn(t).map(ok)), usage: { inputTokens: 1, outputTokens: 1, cachedReadTokens: 0, cachedWriteTokens: 0, totalTokens: 2 } }; } };
    const results: string[] = [];
    let checks = 0;
    const r = await analyzeBatches(b, [[item("a")], [item("b")], [item("c")]], {
      timeoutMs: 1000, baselineSummary: null, onResult: async (id) => { results.push(id); }, onFailed: async () => {},
      beforeBatch: async () => (++checks === 3 ? { kind: "budget", detail: "예산" } : null),
      onUsage: (u) => usages.push(u),
    });
    expect(r.stopped).toEqual({ kind: "budget", detail: "예산" });
    expect(results).toEqual(["a", "b"]);
    expect(sent).toBe(2);
    expect(usages).toHaveLength(2);
  });
});
