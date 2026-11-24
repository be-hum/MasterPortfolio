import { describe, it, expect } from "vitest";
import { isSystemPath } from "../../src/discovery/system.js";

describe("isSystemPath win32", () => {
  const home = "C:\\Users\\kim";
  it("excludes Windows system folders on any drive, case-insensitively", () => {
    expect(isSystemPath("C:\\Windows\\System32", home, "win32")).toBe(true);
    expect(isSystemPath("c:\\windows", home, "win32")).toBe(true);
    expect(isSystemPath("D:/Program Files/app", home, "win32")).toBe(true);
    expect(isSystemPath("D:/Program Files (x86)/app", home, "win32")).toBe(true);
    expect(isSystemPath("C:/ProgramData/x", home, "win32")).toBe(true);
    expect(isSystemPath("D:/$Recycle.Bin", home, "win32")).toBe(true);
  });
  it("does not exclude look-alike names", () => {
    expect(isSystemPath("C:/WindowsApps-tools", home, "win32")).toBe(false);
    expect(isSystemPath("C:/Program Files Backup", home, "win32")).toBe(false);
  });
  it("excludes other users' profiles (including Public, Default, All Users)", () => {
    expect(isSystemPath("C:/Users/other/Documents", home, "win32")).toBe(true);
    expect(isSystemPath("C:/Users/Public", home, "win32")).toBe(true);
    expect(isSystemPath("C:/Users/Default", home, "win32")).toBe(true);
    expect(isSystemPath("C:/Users/All Users", home, "win32")).toBe(true);
  });
  it("allows the current home and everything under it", () => {
    expect(isSystemPath("C:\\Users\\kim", home, "win32")).toBe(false);
    expect(isSystemPath("C:\\Users\\kim\\Documents\\보고서.pdf", home, "win32")).toBe(false);
    expect(isSystemPath("D:/Users/kim/x", home, "win32")).toBe(false);
  });
  it("allows ordinary folders on other drives", () => {
    expect(isSystemPath("D:/대학", home, "win32")).toBe(false);
    expect(isSystemPath("D:\\대학\\projects", home, "win32")).toBe(false);
  });
  it("treats an 8.3 short name of the current profile as the same profile", () => {
    const ci = "C:\\Users\\runneradmin";
    expect(isSystemPath("C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\mp-test-1", ci, "win32")).toBe(false);
    expect(isSystemPath("C:\\Users\\OTHER~1\\Documents", ci, "win32")).toBe(true);
  });
});

describe("isSystemPath darwin", () => {
  const home = "/Users/kim";
  it("excludes macOS system folders and their children", () => {
    expect(isSystemPath("/System/Library", home, "darwin")).toBe(true);
    expect(isSystemPath("/Library/Foo", home, "darwin")).toBe(true);
    expect(isSystemPath("/Applications/X.app", home, "darwin")).toBe(true);
    expect(isSystemPath("/private/var/x", home, "darwin")).toBe(true);
    expect(isSystemPath("/usr/local", home, "darwin")).toBe(true);
    expect(isSystemPath("/bin", home, "darwin")).toBe(true);
    expect(isSystemPath("/sbin", home, "darwin")).toBe(true);
  });
  it("excludes other users' profiles and /Users/Shared", () => {
    expect(isSystemPath("/Users/other/Documents", home, "darwin")).toBe(true);
    expect(isSystemPath("/Users/Shared", home, "darwin")).toBe(true);
  });
  it("allows the current home, its Library, and ordinary volumes", () => {
    expect(isSystemPath("/Users/kim", home, "darwin")).toBe(false);
    expect(isSystemPath("/Users/kim/Documents", home, "darwin")).toBe(false);
    expect(isSystemPath("/Users/kim/Library/Notes", home, "darwin")).toBe(false);
    expect(isSystemPath("/Volumes/Data/x", home, "darwin")).toBe(false);
    expect(isSystemPath("/Users/KIM/Documents", home, "darwin")).toBe(false);
  });
});

describe("isSystemPath other platforms", () => {
  it("does not apply Windows or macOS rules on linux", () => {
    expect(isSystemPath("/usr/local", "/home/kim", "linux")).toBe(false);
    expect(isSystemPath("/Users/other/Documents", "/home/kim", "linux")).toBe(false);
  });
});
