import { describe, it, expect } from "vitest";
import { extractJsonArray, validateBatchReply, validateJudgeReply } from "../../src/analyzer/parse.js";

const ok = (id: string) => ({
  id, type: "기타", use_for: [], title: "t", summary: "s", detail: "d", excerpts: [], period: null, role: null,
  skills: [], metrics: [], org: null, in_resume: "판단불가",
});

describe("extractJsonArray (Review Focus 4)", () => {
  it("parses a bare array", () => { expect(extractJsonArray('[{"a":1}]')).toEqual([{ a: 1 }]); });
  it("parses a fenced array with surrounding prose", () => {
    expect(extractJsonArray('결과입니다.\n```json\n[{"a":"]"}]\n```\n끝')).toEqual([{ a: "]" }]);
  });
  it("parses an array embedded in prose without fences", () => {
    expect(extractJsonArray('다음과 같습니다: [{"a":1},{"b":"x[y]"}] 이상입니다.')).toEqual([{ a: 1 }, { b: "x[y]" }]);
  });
  it("returns null when there is no array", () => { expect(extractJsonArray("없음")).toBeNull(); });
});

describe("validateBatchReply", () => {
  it("accepts valid items, reports invalid and missing", () => {
    const r = validateBatchReply([ok("a"), { ...ok("b"), type: "일기" }, ok("zzz")], ["a", "b", "c"]);
    expect([...r.valid.keys()]).toEqual(["a"]);
    expect(r.missing.sort()).toEqual(["b", "c"]);
    expect(r.errors.length).toBeGreaterThan(0);
  });
});

describe("extractJsonArray hardening", () => {
  it("prefers the array of objects with id over earlier stray arrays", () => {
    expect(extractJsonArray('Found [1] item. [{"id":"a","x":1}]')).toEqual([{ id: "a", x: 1 }]);
  });
  it("is bounded on pathological input", () => {
    const t0 = Date.now();
    expect(extractJsonArray("[".repeat(200_000))).toBeNull();
    expect(Date.now() - t0).toBeLessThan(1000);
  });
  it("duplicate suppression matches exact ids", () => {
    const r = validateBatchReply([{ ...ok("a"), type: "일기" }], ["a", "a1"]);
    expect(r.errors.some((e) => e.includes("id=a1 누락"))).toBe(true);
  });
});

describe("validateBatchReply drops value fields from extraction", () => {
  it("strips value/value_reason the model may still send", () => {
    const r = validateBatchReply([{ ...ok("a"), value: "상", value_reason: "x" }], ["a"]);
    expect(r.valid.get("a")).not.toHaveProperty("value");
    expect(r.valid.get("a")).not.toHaveProperty("value_reason");
  });
});

describe("validateJudgeReply", () => {
  it("accepts valid judgements, reports invalid, unknown and missing", () => {
    const r = validateJudgeReply([{ id: "c1", value: "상", value_reason: "r" }, { id: "c2", value: "최상", value_reason: "r" }, { id: "zz", value: "하", value_reason: "r" }], ["c1", "c2", "c3"]);
    expect([...r.valid.keys()]).toEqual(["c1"]);
    expect(r.missing).toEqual(["c2", "c3"]);
    expect(r.errors.some((e) => e.includes("알 수 없는 id=zz"))).toBe(true);
  });
});

describe("validateBatchReply trims long output instead of rejecting it (§9.7 D)", () => {
  it("keeps one summary line, 2 detail lines, 1 excerpt of 100 chars, 8 skills, 3 metrics", () => {
    const r = validateBatchReply([{
      ...ok("a"), summary: "첫 줄\n둘째 줄", detail: "1\n\n2\n3\n4", excerpts: ["가".repeat(150), "둘째"],
      skills: Array.from({ length: 12 }, (_, i) => `s${i}`), metrics: ["m1", "m2", "m3", "m4"],
    }], ["a"]);
    const a = r.valid.get("a")!;
    expect(r.errors).toEqual([]);
    expect(a.summary).toBe("첫 줄");
    expect(a.detail).toBe("1\n2");
    expect(a.excerpts).toEqual(["가".repeat(100)]);
    expect(a.skills).toEqual(["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7"]);
    expect(a.metrics).toEqual(["m1", "m2", "m3"]);
  });
  it("still rejects an empty summary", () => {
    expect(validateBatchReply([{ ...ok("a"), summary: "  \n " }], ["a"]).missing).toEqual(["a"]);
  });
});
