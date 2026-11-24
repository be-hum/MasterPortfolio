import { describe, it, expect } from "vitest";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { findCandidateFolders } from "../../src/discovery/candidates.js";
import { mkTmp } from "../helpers/tmp.js";

describe("findCandidateFolders", () => {
  it("finds matching folders within depth and collapses nested matches", async () => {
    const root = await mkTmp();
    await mkdir(join(root, "a", "b", "연세대_자료", "projects"), { recursive: true });
    await mkdir(join(root, "a", "b", "c", "d", "e", "project-deep"), { recursive: true });
    await mkdir(join(root, "kubernetes"), { recursive: true });
    await mkdir(join(root, ".hidden", "project"), { recursive: true });
    const found = await findCandidateFolders(root, ["project", "연세대", "YU"], 4);
    expect(found).toEqual([join(root, "a", "b", "연세대_자료")]);
  });
});

describe("findCandidateFolders exclusions", () => {
  it("returns nothing for a system root", async () => {
    expect(await findCandidateFolders("/System", ["project"], 4, { home: "/Users/kim", platform: "darwin" })).toEqual([]);
  });

  it("skips excluded dir names case-insensitively on win32 only", async () => {
    const root = await mkTmp();
    await mkdir(join(root, "NODE_MODULES", "project-x"), { recursive: true });
    await mkdir(join(root, "work", "project-y"), { recursive: true });
    expect(await findCandidateFolders(root, ["project"], 4, { platform: "win32" })).toEqual([join(root, "work", "project-y")]);
    const linux = await findCandidateFolders(root, ["project"], 4, { platform: "linux" });
    expect(linux.sort()).toEqual([join(root, "NODE_MODULES", "project-x"), join(root, "work", "project-y")].sort());
  });
});
