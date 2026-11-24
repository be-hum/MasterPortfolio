import { describe, it, expect } from "vitest";
import { parseFiveHour, parseTokenUsage } from "../../src/agent/usage.js";
import { UsageMeter } from "../../src/agent/budget.js";

describe("parseFiveHour (§9.8)", () => {
  it("reads unifiedWindows.five_hour first", () => {
    expect(parseFiveHour({ "_claude/rateLimit": { status: "allowed", resetsAt: 1, rateLimitType: "seven_day", utilization: 0.9,
      unifiedWindows: { five_hour: { utilization: 0.37, resetsAt: 1795507800 }, seven_day: { utilization: 0.05 } } } })).toEqual({ utilization: 0.37, resetsAt: 1795507800 });
  });
  it("falls back to top-level utilization when rateLimitType is five_hour", () => {
    expect(parseFiveHour({ "_claude/rateLimit": { rateLimitType: "five_hour", utilization: 0.2, resetsAt: 5 } })).toEqual({ utilization: 0.2, resetsAt: 5 });
    expect(parseFiveHour({ "_claude/rateLimit": { rateLimitType: "seven_day", utilization: 0.2 } })).toBeNull();
  });
  it("ignores model/cost-only metadata", () => {
    expect(parseFiveHour({ "_claude/model": "haiku" })).toBeNull();
    expect(parseFiveHour(undefined)).toBeNull();
  });
});

describe("parseTokenUsage", () => {
  it("reads the prompt response usage", () => {
    expect(parseTokenUsage({ stopReason: "end_turn", usage: { inputTokens: 10, outputTokens: 2, cachedReadTokens: 3, cachedWriteTokens: 4, totalTokens: 19 } }))
      .toEqual({ inputTokens: 10, outputTokens: 2, cachedReadTokens: 3, cachedWriteTokens: 4, totalTokens: 19 });
    expect(parseTokenUsage({ stopReason: "end_turn" })).toBeUndefined();
  });
});

describe("UsageMeter (§9.8)", () => {
  const W = 1000;
  it("measures spent from the first reading and stops at the share", () => {
    const m = new UsageMeter(0.3);
    expect(m.hasInfo).toBe(false);
    expect(m.exceeded()).toBe(false);
    m.observe({ utilization: 0.4, resetsAt: W });
    expect(m.start).toBe(0.4);
    expect(m.spent()).toBe(0);
    m.observe({ utilization: 0.65, resetsAt: W });
    expect(m.spent()).toBeCloseTo(0.25);
    expect(m.exceeded()).toBe(false);
    m.observe({ utilization: 0.7, resetsAt: W });
    expect(m.exceeded()).toBe(true);
  });
  it("starts a new window at 0 when resetsAt changes", () => {
    const m = new UsageMeter(0.3);
    m.observe({ utilization: 0.9, resetsAt: W });
    m.observe({ utilization: 0.95, resetsAt: W });
    m.observe({ utilization: 0.1, resetsAt: W + 18000 });
    expect(m.spent()).toBeCloseTo(0.15);
    expect(m.resetsAt).toBe(W + 18000);
  });
  it("flags a high starting utilization once (≥ 1 − share)", () => {
    const m = new UsageMeter(0.3);
    m.observe({ utilization: 0.75, resetsAt: W });
    expect(m.takeHighStartWarning()).toBe(true);
    expect(m.takeHighStartWarning()).toBe(false);
    const n = new UsageMeter(0.3);
    n.observe({ utilization: 0.69, resetsAt: W });
    expect(n.takeHighStartWarning()).toBe(false);
  });
  it("sums tokens per stage", () => {
    const m = new UsageMeter(0.3);
    m.addTokens("extract", { inputTokens: 1, outputTokens: 2, cachedReadTokens: 3, cachedWriteTokens: 4, totalTokens: 10 });
    m.addTokens("extract", { inputTokens: 1, outputTokens: 2, cachedReadTokens: 3, cachedWriteTokens: 4, totalTokens: 10 });
    expect(m.tokens.extract).toEqual({ inputTokens: 2, outputTokens: 4, cachedReadTokens: 6, cachedWriteTokens: 8, totalTokens: 20 });
  });
});
