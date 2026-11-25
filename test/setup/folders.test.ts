import { describe, expect, it } from "vitest";
import { defaultOutputDir, suggestFolders, WSL_KEYWORDS } from "../../src/setup/folders.js";
import { parseWslList, wslHomes } from "../../src/setup/wsl.js";

const set = (...p: string[]) => (x: string) => p.includes(x);

describe("suggestFolders", () => {
  it("win32: basics checked, OneDrive cloud, other drives, keyword candidates, deduped, ordered", async () => {
    const home = "C:\\Users\\u";
    const r = await suggestFolders(["연세"], {
      home, platform: "win32", systemDrive: "C:",
      winFolder: async (n) => ({ MyDocuments: "C:\\Users\\u\\OneDrive - Univ\\Documents", Desktop: "C:\\Users\\u\\Desktop", Downloads: "C:\\Users\\u\\Downloads" })[n],
      exists: set("C:\\Users\\u\\OneDrive - Univ\\Documents", "C:\\Users\\u\\Desktop", "C:\\Users\\u\\Downloads", "C:\\Users\\u\\OneDrive - Univ", "C:\\Users\\u\\OneDrive - Other", "C:\\", "D:\\", "E:\\"),
      listDir: (p) => p === home ? ["OneDrive - Univ", "OneDrive - Other", "x"] : [],
      candidates: async () => ["C:\\Users\\u\\proj", "C:\\Users\\u\\Downloads\\sub", "C:\\Users\\u\\desktop"],
      wslHomes: async () => [],
    });
    expect(r.map((s) => [s.kind, s.checked])).toEqual([
      ["documents", true], ["downloads", true], ["desktop", true], ["cloud", false], ["drive", false], ["drive", false], ["keyword", false],
    ]);
    expect(r.find((s) => s.kind === "cloud")!.label).toBe("클라우드: OneDrive - Other");
    expect(r.filter((s) => s.kind === "drive").map((s) => s.label)).toEqual(["드라이브 D:", "드라이브 E:"]);
    expect(r.at(-1)!.path).toBe("C:\\Users\\u\\proj");
    expect(r[0].label).toBe("문서");
  });

  it("darwin: Volumes without root link are drives, CloudStorage is cloud", async () => {
    const r = await suggestFolders([], {
      home: "/Users/u", platform: "darwin",
      exists: (p) => ["/Users/u/Documents", "/Volumes/Data", "/Users/u/Library/CloudStorage/OneDrive-X", "/Volumes/Macintosh HD"].includes(p),
      listDir: (p) => p === "/Volumes" ? ["Data", "Macintosh HD"] : p === "/Users/u/Library/CloudStorage" ? ["OneDrive-X"] : [],
      realpath: (p) => (p === "/Volumes/Macintosh HD" ? "/" : p),
      candidates: async () => [],
    });
    expect(r.map((s) => s.kind)).toEqual(["documents", "cloud", "drive"]);
    expect(r.some((s) => s.path.endsWith("OneDrive-X") && s.kind === "cloud")).toBe(true);
    expect(r.some((s) => s.path === "/Volumes/Data" && s.kind === "drive")).toBe(true);
  });

  it("linux has no drives", async () => {
    const r = await suggestFolders([], { home: "/h", platform: "linux", exists: set("/h/Documents"), listDir: () => [], candidates: async () => [] });
    expect(r.map((s) => s.kind)).toEqual(["documents"]);
  });
});

describe("WSL folders (win32)", () => {
  const base = { home: "C:\\Users\\u", platform: "win32" as const, systemDrive: "C:", winFolder: async () => null, exists: () => false, listDir: () => [], candidates: async () => [] };

  it("suggests project-like folders inside each WSL home (checked, labeled), never the home itself", async () => {
    const seen: string[][] = [];
    const r = await suggestFolders(["연세대"], {
      ...base,
      wslHomes: async () => [{ distro: "Ubuntu", home: "\\\\wsl.localhost\\Ubuntu\\home\\yh" }],
      wslCandidates: async (h, kw) => { seen.push(kw); return [h, h + "\\projects", h + "\\work\\portfolio"]; },
    });
    expect(r.map((s) => [s.kind, s.checked, s.label, s.path])).toEqual([
      ["wsl", true, "WSL(Ubuntu): ~/projects", "\\\\wsl.localhost\\Ubuntu\\home\\yh\\projects"],
      ["wsl", true, "WSL(Ubuntu): ~/work/portfolio", "\\\\wsl.localhost\\Ubuntu\\home\\yh\\work\\portfolio"],
    ]);
    expect(seen[0]).toEqual([...WSL_KEYWORDS, "연세대"]);
  });

  it("a slow or failing WSL is skipped", async () => {
    const slow = await suggestFolders([], { ...base, wslTimeoutMs: 30, wslHomes: () => new Promise(() => {}) });
    expect(slow).toEqual([]);
    const bad = await suggestFolders([], { ...base, wslHomes: async () => { throw new Error("x"); } });
    expect(bad).toEqual([]);
  });

  it("not searched on other platforms", async () => {
    let called = false;
    await suggestFolders([], { home: "/h", platform: "linux", exists: () => false, listDir: () => [], candidates: async () => [], wslHomes: async () => { called = true; return []; } });
    expect(called).toBe(false);
  });

  it("parses wsl -l -q output (UTF-16LE with NULs) and drops docker-desktop", () => {
    const buf = Buffer.from("\uFEFFUbuntu-26.04\r\ndocker-desktop\r\nDebian\r\n\r\n", "utf16le");
    expect(parseWslList(buf)).toEqual(["Ubuntu-26.04", "Debian"]);
    expect(parseWslList("Ubuntu\n")).toEqual(["Ubuntu"]);
  });

  it("wslHomes lists users under each distro's /home; unreachable distros are skipped", async () => {
    const r = await wslHomes(async () => ["A", "B"], async (p) => { if (p.includes("\\B\\")) throw new Error("off"); return ["z", "yh"]; });
    expect(r).toEqual([{ distro: "A", home: "\\\\wsl.localhost\\A\\home\\yh" }, { distro: "A", home: "\\\\wsl.localhost\\A\\home\\z" }]);
  });
});

describe("defaultOutputDir", () => {
  it("uses Documents/MasterPortfolio, else home", async () => {
    expect(await defaultOutputDir({ home: "/h", platform: "linux", exists: set("/h/Documents") })).toBe("/h/Documents/MasterPortfolio");
    expect(await defaultOutputDir({ home: "/h", platform: "linux", exists: () => false })).toBe("/h/MasterPortfolio");
  });
});
