import { describe, it, expect } from "vitest";
import { sanitize } from "../../src/privacy/mask.js";
import { truncateSanitized, headSanitized, TRUNCATE_HEAD, TRUNCATE_TAIL, TRUNCATE_MARK } from "../../src/privacy/sanitized.js";

describe("truncateSanitized (§9.7 C)", () => {
  it("keeps text up to 4,000 chars as is", () => {
    const s = sanitize("가".repeat(4000)).text;
    expect(truncateSanitized(s)).toBe(s);
  });

  it("sends head 3,500 + marker + tail 500 for longer text", () => {
    const s = sanitize("A".repeat(3500) + "M".repeat(1000) + "Z".repeat(500)).text;
    const t = truncateSanitized(s);
    expect(TRUNCATE_HEAD).toBe(3500);
    expect(TRUNCATE_TAIL).toBe(500);
    expect(TRUNCATE_MARK).toBe("\n…(중략)…\n");
    expect(t).toBe("A".repeat(3500) + "\n…(중략)…\n" + "Z".repeat(500));
  });

  it("masks the full text before slicing, so PII at the cut stays masked", () => {
    const raw = "x".repeat(3490) + " 010-1234-5678 " + "y".repeat(2000);
    const t = truncateSanitized(sanitize(raw).text);
    expect(t).not.toMatch(/\d{4}-\d{4}/);
    expect(t).not.toContain("5678");
  });

  it("headSanitized returns the first n chars", () => {
    expect(headSanitized(sanitize("abcdef").text, 3)).toBe("abc");
  });
});
