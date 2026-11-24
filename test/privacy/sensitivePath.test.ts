import { describe, it, expect } from "vitest";
import { isSensitivePath } from "../../src/privacy/sensitivePath.js";

describe("isSensitivePath", () => {
  it("flags identity documents", () => {
    expect(isSensitivePath("C:/Users/k/Downloads/주민등록등본.pdf", [])).toBe("주민등록");
    expect(isSensitivePath("/Users/k/Downloads/통장사본.jpg", [])).toBe("통장사본");
    expect(isSensitivePath("/Users/k/Downloads/My_Passport.pdf", [])).toBe("passport");
  });
  it("does not flag normal project files", () => {
    expect(isSensitivePath("/Users/k/projects/bank-system/report.pdf", [])).toBeNull();
    expect(isSensitivePath("/Users/k/projects/password-manager/README.md", [])).toBeNull();
  });
  it("respects allowPaths", () => {
    expect(isSensitivePath("/Users/k/docs/근로계약서.pdf", ["/Users/k/docs/근로계약서.pdf"])).toBeNull();
  });
});
