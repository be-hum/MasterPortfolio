import { describe, it, expect } from "vitest";
import { collectScopeFolders, contentNameCheck } from "../../src/scan/scopeCandidates.js";
import { isSensitiveDir } from "../../src/privacy/sensitivePath.js";
import { defaultConfig } from "../../src/config/config.js";
import type { WalkEntry } from "../../src/discovery/walk.js";

const file = (path: string, size = 1000): WalkEntry => ({ kind: "file", path, size, mtimeMs: 0 });
const cfg = (patch: Partial<ReturnType<typeof defaultConfig>> = {}) => ({ ...defaultConfig({ university: { input: "", keywords: [] }, scanFolders: ["/r"], agent: "claude" }), ...patch });

describe("collectScopeFolders (§5.5 대상)", () => {
  it("lists folders that directly hold a candidate file, with masked relative path, ext counts and up to 5 sample names", async () => {
    const entries = [
      ...Array.from({ length: 7 }, (_, i) => file(`/r/과제/캡스톤/보고서${i}.pdf`)),
      file("/r/과제/캡스톤/setup.exe"),
      file("/r/과제/캡스톤/연락처 010-1234-5678.docx"),
      file("/r/root.md"), // 스캔 루트 자체는 대상 아님
      file("/r/짧은/a.txt", 10), // md/txt 하한(200바이트) 미만만 있는 폴더
      file("/r/큰/a.pdf", 60 * 1024 * 1024), // 크기 초과만 있는 폴더
      file("/r/형식/a.exe"), // 지원 형식 없음
    ];
    const fs = await collectScopeFolders([{ root: "/r", entries }], cfg(), { platform: "linux" });
    expect(fs.map((f) => f.path)).toEqual(["/r/과제/캡스톤"]);
    const f = fs[0];
    expect(f.relPath).toBe("과제/캡스톤");
    expect(f.fileCount).toBe(9);
    expect(f.extCounts).toEqual({ ".pdf": 7, ".exe": 1, ".docx": 1 });
    expect(f.samples).toHaveLength(5);
    expect(f.samples.join(" ")).not.toContain("setup.exe");
    const all = await collectScopeFolders([{ root: "/r", entries: [file("/r/x/연락처 010-1234-5678.docx")] }], cfg(), { platform: "linux" });
    expect(all[0].samples).toEqual(["연락처 [전화번호].docx"]);
  });

  it("shows document-like names first so a write-up in a work folder is visible (§5.5 예시 선택)", async () => {
    const names = ["dep0_0.txt", "dep0_1.txt", "ffmap.txt", "flip.txt", "isa_notes.md", "plan.md", "uart_scan.txt", "writeup-submit.md", "최종보고서.pdf", "발표.pptx"];
    const entries = names.map((n) => file(`/r/targets/chal1/work/${n}`));
    const [f] = await collectScopeFolders([{ root: "/r", entries }], cfg(), { platform: "linux" });
    expect(f.samples).toHaveLength(5);
    expect(f.samples.slice(0, 3).sort()).toEqual(["writeup-submit.md", "발표.pptx", "최종보고서.pdf"].sort());
  });

  it("never lists sensitive or secret file names and never sends sensitive folders", async () => {
    const entries = [
      file("/r/계정/github-recovery-codes.txt"), file("/r/계정/메모.md"),
      file("/r/중요자료/보고서.pdf"),
      file("/r/backup-codes/a.md"),
      file("/r/서류/주민등록등본.pdf"),
    ];
    const fs = await collectScopeFolders([{ root: "/r", entries }], cfg(), { platform: "linux" });
    expect(fs.map((f) => f.path)).toEqual(["/r/계정"]);
    expect(fs[0].samples).toEqual(["메모.md"]);
    expect(fs[0].fileCount).toBe(1);
  });

  it("skips folders that already have a decision and dedupes folders seen from overlapping roots", async () => {
    const entries = [file("/r/a/x.pdf"), file("/r/b/y.pdf")];
    const c = cfg({ scope: { decisions: { "/r/a": { decision: "include", by: "llm", at: "t" } } } });
    const fs = await collectScopeFolders([{ root: "/r", entries }, { root: "/r/b", entries: [file("/r/b/y.pdf")] }], c, { platform: "linux" });
    expect(fs.map((f) => f.path)).toEqual(["/r/b"]);
  });
});

describe("contentNameCheck (8.2.1)", () => {
  it("drops sample names whose content holds an account secret, or that cannot be read", async () => {
    const entries = [file("/r/a/메모.txt"), file("/r/a/보고서.md"), file("/r/a/깨짐.pdf")];
    const texts: Record<string, string> = { "/r/a/메모.txt": "-----BEGIN OPENSSH PRIVATE KEY-----\nabc", "/r/a/보고서.md": "평범한 보고서" };
    const extractorFor = () => ({ id: "md" as const, extract: async (p: string) => texts[p] ? { ok: true as const, text: texts[p], meta: {} } : { ok: false as const, reason: "corrupted" as const } });
    const fs = await collectScopeFolders([{ root: "/r", entries }], cfg(), { platform: "linux", nameSafe: contentNameCheck(extractorFor) });
    expect(fs[0].samples).toEqual(["보고서.md"]);
    expect(fs[0].fileCount).toBe(3);
  });
});

describe("isSensitiveDir", () => {
  it("flags folders whose path has a sensitive keyword, 중요자료 or a secret-like name", () => {
    expect(isSensitiveDir("/r/중요자료/sub")).toBeTruthy();
    expect(isSensitiveDir("/r/주민등록")).toBeTruthy();
    expect(isSensitiveDir("/r/recovery codes")).toBeTruthy();
    expect(isSensitiveDir("/r/과제")).toBeNull();
  });
});
