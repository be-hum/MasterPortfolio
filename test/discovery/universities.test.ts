import { describe, it, expect } from "vitest";
import { expandUniversity, loadUniversities } from "../../src/discovery/universities.js";

describe("expandUniversity", () => {
  const dict = loadUniversities();
  it("expands from Korean short name", () => {
    const k = expandUniversity("연세대", dict);
    expect(k).toEqual(expect.arrayContaining(["연세대학교", "연세대", "Yonsei University", "Yonsei", "YU"]));
  });
  it("expands from English abbreviation, case-insensitive", () => {
    expect(expandUniversity("kaist", dict)).toEqual(expect.arrayContaining(["한국과학기술원", "KAIST"]));
  });
  it("returns only the input when not in dictionary", () => {
    expect(expandUniversity("가나다대학교", dict)).toEqual(["가나다대학교", "가나다대"]);
  });
  it("dictionary has no duplicate names", () => {
    const names = dict.map((u) => u.name);
    expect(new Set(names).size).toBe(names.length);
  });
  it("does not add generic first English words", () => {
    const seoul = expandUniversity("서울시립대학교", dict);
    expect(seoul).not.toContain("University");
    expect(seoul).not.toContain("Seoul");
    expect(expandUniversity("고려대", dict)).not.toContain("Korea");
    expect(expandUniversity("고려대", dict)).toContain("Korea University");
  });
  it("returns [] for empty or whitespace input", () => {
    expect(expandUniversity("", dict)).toEqual([]);
    expect(expandUniversity("   ", dict)).toEqual([]);
  });
  it("merges all entries sharing an abbreviation", () => {
    const k = expandUniversity("YU", dict);
    expect(k).toEqual(expect.arrayContaining(["연세대학교", "영남대학교"]));
  });
});
