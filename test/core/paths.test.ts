import { describe, it, expect } from "vitest";
import { normalizePath } from "../../src/core/paths.js";

describe("normalizePath", () => {
  it("converts backslashes to slashes", () => {
    expect(normalizePath("C:\\Users\\kim\\Documents\\보고서.pdf")).toBe("C:/Users/kim/Documents/보고서.pdf");
  });
  it("uppercases a windows drive letter", () => { expect(normalizePath("d:\\대학\\a.pdf")).toBe("D:/대학/a.pdf"); });
  it("leaves posix paths unchanged", () => { expect(normalizePath("/Users/kim/a.pdf")).toBe("/Users/kim/a.pdf"); });
});
