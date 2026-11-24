import { describe, it, expect } from "vitest";
import { classifyError, classifyRpcError } from "../../src/agent/classify.js";

describe("classifyError", () => {
  it.each([
    ["Claude usage limit reached (429 rate limit)", "rate_limit"],
    ["You exceeded your current quota", "rate_limit"],
    ["You've hit your usage limit. Upgrade to Plus to continue using Codex.", "rate_limit"],
    ["RESOURCE_EXHAUSTED", "rate_limit"],
    ["Authentication required", "auth"],
    ["Not logged in · Please run /login", "auth"],
    ["401 Unauthorized", "auth"],
    ["캡스톤 프로젝트 보고서 분석 결과", "other"],
    ["something else", "other"],
  ])("%s → %s", (m, k) => expect(classifyError(m)).toBe(k));
});

describe("classifyRpcError", () => {
  it("uses data.errorKind and code -32000", () => {
    expect(classifyRpcError({ message: "Internal error: x", code: -32603, data: { errorKind: "rate_limit" } })).toBe("rate_limit");
    expect(classifyRpcError({ message: "Authentication required", code: -32000 })).toBe("auth");
  });
  it("maps data.errorKind billing_error to rate_limit", () => {
    expect(classifyRpcError({ message: "Internal error", code: -32603, data: { errorKind: "billing_error" } })).toBe("rate_limit");
  });
  it("reads text from data.details", () => {
    expect(classifyRpcError({ message: "Internal error", code: -32603, data: { details: "Claude usage limit reached (429 rate limit)" } })).toBe("rate_limit");
  });
});
