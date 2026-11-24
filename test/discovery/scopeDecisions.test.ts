import { describe, it, expect } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { scopeResolver, setScopeDecision, resetScopeDecisions, type ScopeDecisions } from "../../src/discovery/scopeDecisions.js";
import { walk } from "../../src/discovery/walk.js";
import { mkTmp } from "../helpers/tmp.js";

const d = (decision: "include" | "exclude", by: "llm" | "user" = "llm") => ({ decision, by, at: "2026-11-24T00:00:00.000Z" });

describe("scopeResolver (§5.5 적용)", () => {
  it("follows the nearest ancestor-or-self decision", () => {
    const r = scopeResolver({ "/a": d("exclude"), "/a/b": d("include"), "/a/b/c": d("exclude") }, "linux");
    expect(r.decisionFor("/a")).toBe("exclude");
    expect(r.decisionFor("/a/x/y")).toBe("exclude");
    expect(r.decisionFor("/a/b")).toBe("include");
    expect(r.decisionFor("/a/b/z")).toBe("include");
    expect(r.decisionFor("/a/b/c/d")).toBe("exclude");
    expect(r.decisionFor("/other")).toBeNull();
    expect(r.decisionFor("/ab")).toBeNull(); // 접두사만 같은 형제
  });
  it("knows whether an include decision lies strictly below a folder", () => {
    const r = scopeResolver({ "/a": d("exclude"), "/a/b/c": d("include") }, "linux");
    expect(r.includeBelow("/a")).toBe(true);
    expect(r.includeBelow("/a/b")).toBe(true);
    expect(r.includeBelow("/a/b/c")).toBe(false);
    expect(r.includeBelow("/x")).toBe(false);
  });
  it("compares case-insensitively on win32, darwin and WSL /mnt/<drive>, exactly elsewhere", () => {
    expect(scopeResolver({ "C:/Users/Kim/Docs": d("exclude") }, "win32").decisionFor("c:\\users\\kim\\docs\\sub")).toBe("exclude");
    expect(scopeResolver({ "/Users/kim/Docs": d("exclude") }, "darwin").decisionFor("/users/kim/docs")).toBe("exclude");
    expect(scopeResolver({ "/mnt/c/Users/Kim": d("exclude") }, "linux").decisionFor("/mnt/c/users/kim/x")).toBe("exclude");
    expect(scopeResolver({ "/home/Kim": d("exclude") }, "linux").decisionFor("/home/kim/x")).toBeNull();
    expect(scopeResolver({ "C:/": d("exclude") }, "win32").decisionFor("C:\\x")).toBe("exclude");
  });
});

describe("setScopeDecision / resetScopeDecisions (§5.5 저장)", () => {
  it("stores by normalized absolute path and never lets the LLM overwrite a user decision", () => {
    const ds: ScopeDecisions = {};
    expect(setScopeDecision(ds, "C:\\Users\\Kim\\과제", "include", "user", "t1", "win32")).toBe(true);
    expect(Object.keys(ds)).toEqual(["C:/Users/Kim/과제"]);
    expect(setScopeDecision(ds, "c:/users/kim/과제", "exclude", "llm", "t2", "win32")).toBe(false);
    expect(ds["C:/Users/Kim/과제"]).toEqual({ decision: "include", by: "user", at: "t1" });
    // 사용자는 덮어쓸 수 있고, 같은 키(대소문자만 다른 경로)를 다시 쓴다
    expect(setScopeDecision(ds, "c:/users/kim/과제", "exclude", "user", "t3", "win32")).toBe(true);
    expect(ds).toEqual({ "C:/Users/Kim/과제": { decision: "exclude", by: "user", at: "t3" } });
  });
  it("keeps the original case in the key (WSL /mnt paths too) and trims a trailing slash", () => {
    const ds: ScopeDecisions = {};
    setScopeDecision(ds, "/mnt/c/Users/user/Docs/", "exclude", "llm", "t", "linux");
    expect(Object.keys(ds)).toEqual(["/mnt/c/Users/user/Docs"]);
  });
  it("reset removes the path and every decision below it", () => {
    const ds: ScopeDecisions = { "/a": d("exclude"), "/a/b": d("include", "user"), "/ab": d("include"), "/x": d("include") };
    expect(resetScopeDecisions(ds, "/a/", "linux").sort()).toEqual(["/a", "/a/b"]);
    expect(Object.keys(ds).sort()).toEqual(["/ab", "/x"]);
  });
});

describe("walk with scope decisions", () => {
  it("prunes excluded folders but still descends toward an included descendant", async () => {
    const root = await mkTmp();
    try {
      const f = async (...p: string[]) => { await mkdir(join(root, ...p.slice(0, -1)), { recursive: true }); await writeFile(join(root, ...p), "x"); };
      await f("keep", "a.md");
      await f("drop", "b.md");
      await f("drop", "deep", "c.md");
      await f("drop", "mid", "d.md");
      await f("drop", "mid", "back", "e.md");
      await f("drop", "mid", "back", "inner", "g.md");
      const scope: ScopeDecisions = {
        [join(root, "drop").replace(/\\/g, "/")]: d("exclude"),
        [join(root, "drop", "mid", "back").replace(/\\/g, "/")]: d("include", "user"),
      };
      const { entries } = await walk(root, { scope });
      const files = entries.map((e) => e.path).sort();
      expect(files).toEqual([
        join(root, "drop", "mid", "back", "e.md"), join(root, "drop", "mid", "back", "inner", "g.md"), join(root, "keep", "a.md"),
      ].sort());
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it("an excluded scan root yields nothing", async () => {
    const root = await mkTmp();
    try {
      await writeFile(join(root, "a.md"), "x");
      const { entries } = await walk(root, { scope: { [root.replace(/\\/g, "/")]: d("exclude") } });
      expect(entries).toEqual([]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
