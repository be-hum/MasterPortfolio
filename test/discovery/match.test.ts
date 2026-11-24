import { describe, it, expect } from "vitest";
import { folderMatchesKeyword, tokenize } from "../../src/discovery/match.js";

describe("tokenize", () => {
  it("splits on separators, camelCase and digit/letter boundaries", () => {
    expect(tokenize("2023KU_capstoneProject")).toEqual(["2023", "KU", "capstone", "Project"]);
  });
});

describe("folderMatchesKeyword", () => {
  it("short keywords match whole tokens only", () => {
    expect(folderMatchesKeyword("KU_과제", "KU")).toBe(true);
    expect(folderMatchesKeyword("kubernetes", "KU")).toBe(false);
    expect(folderMatchesKeyword("고대사_레포트", "고대")).toBe(false);
    expect(folderMatchesKeyword("2023고대", "고대")).toBe(true);
  });
  it("long keywords match as case-insensitive substring", () => {
    expect(folderMatchesKeyword("my-projects", "project")).toBe(true);
    expect(folderMatchesKeyword("연세대학교_4학년", "연세대학교")).toBe(true);
    expect(folderMatchesKeyword("YonseiUniv", "Yonsei")).toBe(true);
  });
});
