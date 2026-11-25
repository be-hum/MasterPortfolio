import { describe, expect, it } from "vitest";
import { defaultOutputDir, suggestFolders } from "../../src/setup/folders.js";

const set = (...p: string[]) => (x: string) => p.includes(x);

describe("suggestFolders", () => {
  it("win32: basics checked, OneDrive cloud, other drives, keyword candidates, deduped, ordered", async () => {
    const home = "C:/Users/u";
    const r = await suggestFolders(["연세"], {
      home, platform: "win32", systemDrive: "C:",
      winFolder: async (n) => ({ MyDocuments: "C:/Users/u/OneDrive - Univ/Documents", Desktop: "C:/Users/u/Desktop", Downloads: "C:/Users/u/Downloads" })[n],
      exists: set("C:/Users/u/OneDrive - Univ/Documents", "C:/Users/u/Desktop", "C:/Users/u/Downloads", "C:/Users/u/OneDrive - Univ", "C:/Users/u/OneDrive - Other", "C:\\", "D:\\", "E:\\"),
      listDir: (p) => p === home ? ["OneDrive - Univ", "OneDrive - Other", "x"] : [],
      candidates: async () => ["C:/Users/u/proj", "C:/Users/u/Downloads/sub", "C:/Users/u/desktop"],
    });
    expect(r.map((s) => [s.kind, s.checked])).toEqual([
      ["documents", true], ["downloads", true], ["desktop", true], ["cloud", false], ["drive", false], ["drive", false], ["keyword", false],
    ]);
    expect(r.find((s) => s.kind === "cloud")!.label).toBe("클라우드: OneDrive - Other");
    expect(r.filter((s) => s.kind === "drive").map((s) => s.label)).toEqual(["드라이브 D:", "드라이브 E:"]);
    expect(r.at(-1)!.path).toBe("C:/Users/u/proj");
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

describe("defaultOutputDir", () => {
  it("uses Documents/MasterPortfolio, else home", async () => {
    expect(await defaultOutputDir({ home: "/h", platform: "linux", exists: set("/h/Documents") })).toBe("/h/Documents/MasterPortfolio");
    expect(await defaultOutputDir({ home: "/h", platform: "linux", exists: () => false })).toBe("/h/MasterPortfolio");
  });
});
