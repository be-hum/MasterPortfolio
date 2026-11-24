import { describe, it, expect } from "vitest";
import type { Dirent } from "node:fs";
import { mkdir, rm, writeFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { walk, isExcludedDirName, isExcludedFileName, isUnderAny, resolveEntry, isGeneratedDirName, isGeneratedFileName, splitOutputFiles } from "../../src/discovery/walk.js";
import { mkTmp } from "../helpers/tmp.js";

describe("walk", () => {
  it("lists files, treats git repos as units, skips excluded dirs and symlinks", async () => {
    const root = await mkTmp();
    await mkdir(join(root, "과제"), { recursive: true });
    await writeFile(join(root, "과제", "보고서.pdf"), "x");
    await mkdir(join(root, "app", ".git"), { recursive: true });
    await writeFile(join(root, "app", "README.md"), "x");
    await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
    await writeFile(join(root, "node_modules", "pkg", "a.md"), "x");
    try { await symlink(join(root, "과제"), join(root, "link"), "junction"); } catch { /* 권한 없으면 생략 */ }

    const { entries } = await walk(root);
    const files = entries.filter((e) => e.kind === "file").map((e) => e.path);
    const repos = entries.filter((e) => e.kind === "repo").map((e) => e.path);
    expect(files).toEqual([join(root, "과제", "보고서.pdf")]);
    expect(repos).toEqual([join(root, "app")]);
  });
});

describe("walk exclusions", () => {
  it("returns nothing for a system root without touching the filesystem", async () => {
    const r = await walk("/usr", { home: "/Users/kim", platform: "darwin" });
    expect(r).toEqual({ entries: [], inaccessible: [], generated: [] });
  });

  it("matches excluded dir names case-insensitively on win32 only", () => {
    expect(isExcludedDirName("NODE_MODULES", "win32")).toBe(true);
    expect(isExcludedDirName("appdata", "win32")).toBe(true);
    expect(isExcludedDirName("NODE_MODULES", "darwin")).toBe(false);
    expect(isExcludedDirName("node_modules", "darwin")).toBe(true);
  });

  it("classifies dirents flagged as symlinks by lstat instead of trusting the flag", async () => {
    const root = await mkTmp();
    await mkdir(join(root, "real"));
    await writeFile(join(root, "f.txt"), "x");
    const flagged = (name: string) =>
      ({ name, isSymbolicLink: () => true, isDirectory: () => false, isFile: () => false }) as unknown as Dirent;
    expect((await resolveEntry(flagged("real"), join(root, "real"))).kind).toBe("dir");
    expect((await resolveEntry(flagged("f.txt"), join(root, "f.txt"))).kind).toBe("file");
    expect(await resolveEntry(flagged("gone"), join(root, "gone"))).toEqual({ kind: "error" });
  });
});

describe("walk excludeRoots", () => {
  it("skips paths equal to or under an excluded root", async () => {
    const root = await mkTmp();
    try {
      await mkdir(join(root, "MasterPortfolio", "files"), { recursive: true });
      await writeFile(join(root, "MasterPortfolio", "index.md"), "x");
      await writeFile(join(root, "MasterPortfolio", "files", "card.md"), "x");
      await writeFile(join(root, "MasterPortfolio2.md"), "x"); // 접두사만 같은 형제는 포함
      await writeFile(join(root, "keep.md"), "x");
      const { entries } = await walk(root, { excludeRoots: [join(root, "MasterPortfolio") + "/"] });
      expect(entries.map((e) => e.path).sort()).toEqual([join(root, "MasterPortfolio2.md"), join(root, "keep.md")].sort());
      expect((await walk(join(root, "MasterPortfolio"), { excludeRoots: [join(root, "MasterPortfolio")] })).entries).toEqual([]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("compares case-insensitively on win32/darwin and WSL drive mounts only", () => {
    expect(isUnderAny("C:\\Users\\Kim\\Documents\\mp\\files", ["c:/users/kim/documents/MP"], "win32")).toBe(true);
    expect(isUnderAny("/Users/kim/Documents/MP/x.md", ["/users/kim/documents/mp"], "darwin")).toBe(true);
    expect(isUnderAny("/home/kim/MP/x.md", ["/home/kim/mp"], "linux")).toBe(false);
    expect(isUnderAny("/mnt/c/Users/user/Documents/masterportfolio/x.md", ["/mnt/c/Users/user/Documents/MasterPortfolio"], "linux")).toBe(true);
    expect(isUnderAny("/home/kim/mpx", ["/home/kim/mp"], "linux")).toBe(false);
  });
});

describe("walk hidden and system files", () => {
  it("skips dot-entries at any depth and Office/Windows system files, keeps .git repo detection", async () => {
    const root = await mkTmp();
    try {
      await mkdir(join(root, ".agents"), { recursive: true });
      await writeFile(join(root, ".agents", "skill.md"), "x");
      await mkdir(join(root, ".claude"), { recursive: true });
      await writeFile(join(root, ".claude", "x.md"), "x");
      await mkdir(join(root, "sub", ".hidden"), { recursive: true });
      await writeFile(join(root, "sub", ".hidden", "deep.md"), "x");
      await writeFile(join(root, "sub", ".env"), "x");
      await writeFile(join(root, "sub", "~$draft.docx"), "x");
      await writeFile(join(root, "sub", "Thumbs.db"), "x");
      await writeFile(join(root, "desktop.ini"), "x");
      await writeFile(join(root, "sub", "report.md"), "x");
      await mkdir(join(root, "app", ".git"), { recursive: true });
      await writeFile(join(root, "app", "README.md"), "x");
      const { entries } = await walk(root);
      expect(entries.filter((e) => e.kind === "file").map((e) => e.path)).toEqual([join(root, "sub", "report.md")]);
      expect(entries.filter((e) => e.kind === "repo").map((e) => e.path)).toEqual([join(root, "app")]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("walks a hidden directory the user passed explicitly as a scan root", async () => {
    const parent = await mkTmp();
    try {
      const root = join(parent, ".notes");
      await mkdir(join(root, "2025"), { recursive: true });
      await writeFile(join(root, "2025", "memo.md"), "x");
      await writeFile(join(root, ".DS_Store"), "x");
      expect((await walk(root)).entries.map((e) => e.path)).toEqual([join(root, "2025", "memo.md")]);
    } finally { await rm(parent, { recursive: true, force: true }); }
  });

  it("matches system file names", () => {
    for (const n of ["Thumbs.db", "thumbs.db", "desktop.ini", "Desktop.ini", "~$보고서.docx", ".env"]) expect(isExcludedFileName(n)).toBe(true);
    for (const n of ["report.md", "~draft.md", "my.desktop.ini.md"]) expect(isExcludedFileName(n)).toBe(false);
  });
});

describe("walk generated-output exclusions (§9.7 B)", () => {
  it("matches generated dir names case-insensitively, including *.rep (Ghidra)", () => {
    for (const n of ["out", "tmp", "Temp", "logs", "cache", "vendor", "third_party", "site-packages", "proj.rep", "X.REP"]) expect(isGeneratedDirName(n)).toBe(true);
    for (const n of ["output", "report", "rep", "과제", "templates"]) expect(isGeneratedDirName(n)).toBe(false);
  });

  it("matches license/build/meta file names case-insensitively", () => {
    for (const n of ["LICENSE", "license.txt", "COPYING.md", "NOTICE", "CHANGELOG.md", "AUTHORS.txt", "CONTRIBUTING.md", "CODE_OF_CONDUCT.md",
      "SECURITY.md", "security.md", "CMakeLists.txt", "requirements.txt", "requirements-dev.txt", "robots.txt"]) expect(isGeneratedFileName(n)).toBe(true);
    for (const n of ["LICENSE-MIT", "license.MIT.txt"]) expect(isGeneratedFileName(n), n).toBe(true);
    for (const n of ["보고서.md", "README.md", "security-report.md", "requirements.md", "notes.txt",
      "licensed-work.md", "notice_대회공지.md", "authorship-report.md", "changelog-분석과제.md"]) expect(isGeneratedFileName(n), n).toBe(false);
  });

  it("excludes lecture materials by folder and file name (Korean words anywhere, English only exact or numbered)", () => {
    for (const n of ["강의자료", "강의 자료", "강의안", "강의노트", "수업자료", "수업 자료", "교안", "교재", "강의록", "녹취본", "2026-1 강의자료",
      "lecture", "Lectures", "lecture notes", "Lecture_Notes", "course materials", "handouts", "syllabus"]) expect(isGeneratedDirName(n), n).toBe(true);
    for (const n of ["lecture-exam-analyzer", "프로젝트", "과제", "수업", "강의평가 정리", "notes"]) expect(isGeneratedDirName(n), n).toBe(false);
    for (const n of ["강의안2-고대 그리스.pdf", "강의자료_3주차.pdf", "수업자료.pptx", "EmbeddedSystemsDesign-lecture02.pdf", "Lecture 3 - Hashing.pdf",
      "lecture_notes.md", "OS_교안_5장.pdf", "syllabus-2026.txt"]) expect(isGeneratedFileName(n), n).toBe(true);
    for (const n of ["강의평가_보고서.md", "lecture-exam-analyzer.md", "보고서.pdf", "발표자료.pptx", "설계 비교안.md", "비교재료.md"]) expect(isGeneratedFileName(n), n).toBe(false);
  });

  it("finds split outputs: 10+ files with the same <prefix><digits>.(txt|md) in one folder", () => {
    const pages = Array.from({ length: 10 }, (_, i) => `page-${String(i + 1).padStart(4, "0")}.txt`);
    const nine = Array.from({ length: 9 }, (_, i) => `chunk_${i}.md`);
    const got = splitOutputFiles([...pages, ...nine, "page-0001.pdf", "summary.md"]);
    expect([...got].sort()).toEqual([...pages].sort());
    const mixed = [...Array.from({ length: 5 }, (_, i) => `part${i}.txt`), ...Array.from({ length: 5 }, (_, i) => `part${i + 5}.md`)];
    expect(splitOutputFiles(mixed).size).toBe(10);
  });

  it("keeps numbered user work (week1.md … week15.md) unless the prefix is a generated one or the run is very long", () => {
    const weeks = Array.from({ length: 15 }, (_, i) => `week${i + 1}.md`);
    expect(splitOutputFiles(weeks).size).toBe(0);
    const hw = Array.from({ length: 12 }, (_, i) => `과제${i + 1}.txt`);
    expect(splitOutputFiles(hw).size).toBe(0);
    for (const pre of ["page_", "p", "chunk-", "slide", "seg", "frame_", "ocr-", "split"]) {
      const g = Array.from({ length: 10 }, (_, i) => `${pre}${i + 1}.txt`);
      expect(splitOutputFiles(g).size, pre).toBe(10);
    }
    const long = Array.from({ length: 50 }, (_, i) => `note${i + 1}.md`);
    expect(splitOutputFiles(long).size).toBe(50);
  });

  it("skips generated dirs, meta files and split outputs, and lists them in generated", async () => {
    const root = await mkTmp();
    try {
      await mkdir(join(root, "proj.rep", "x"), { recursive: true });
      await writeFile(join(root, "proj.rep", "x", "CMake.md"), "x");
      await mkdir(join(root, "tmp"));
      await writeFile(join(root, "tmp", "a.md"), "x");
      await mkdir(join(root, "pages"));
      for (let i = 1; i <= 12; i++) await writeFile(join(root, "pages", `page-${String(i).padStart(4, "0")}.txt`), "x");
      await writeFile(join(root, "pages", "원본.pdf"), "x");
      await writeFile(join(root, "LICENSE"), "x");
      await writeFile(join(root, "CMakeLists.txt"), "x");
      await writeFile(join(root, "보고서.md"), "x");
      const r = await walk(root);
      const files = r.entries.filter((e) => e.kind === "file").map((e) => e.path).sort();
      expect(files).toEqual([join(root, "pages", "원본.pdf"), join(root, "보고서.md")].sort());
      // 폴더 2개 + 파일 2개 + 분할본 12개
      expect(r.generated).toHaveLength(16);
      expect(r.generated).toContain(join(root, "proj.rep"));
      expect(r.generated).toContain(join(root, "LICENSE"));
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
