import { describe, it, expect } from "vitest";
import { loadLogic, type Filter } from "../../src/ui/appLogic.js";
import type { UiExperience } from "../../src/ui/model.js";

const L = loadLogic();
const x = (title: string, over: Partial<UiExperience> = {}): UiExperience => ({
  rel: `experiences/${title}.md`, title, category: "프로젝트", period: null, org: null, role: null, team: null, contribution: null,
  skills: [], metrics: [], star: null, evidence: [], review: "adopted", value: "상", questions: [], pending_apply: false, edited: false,
  keywords: [], outcome_keywords: [], raw: { period: null, role: null, team_size: null, category: null, metrics: [] }, ...over,
});
const f = (over: Partial<Filter> = {}): Filter => ({ statuses: null, contribs: [], category: null, q: "", todo: null, ...over });
const titles = (xs: UiExperience[]) => xs.map((e) => e.title);

describe("app logic (11.5)", () => {
  const list = [
    x("A", { review: "pending", contribution: "AI 주도", category: "대회·CTF", keywords: ["VM 역공학"] }),
    x("B", { review: "adopted", contribution: "직접 수행", skills: ["PyTorch"], questions: [{ id: "q1", field: "role", q: "?", a: null }] }),
    x("C", { review: "held", pending_apply: true, metrics: ["정확도 92%"] }),
    x("D", { review: "excluded", pending_apply: true }),
    x("E", { review: "adopted", pending_apply: true, questions: [{ id: "q1", field: "role", q: "?", a: "팀장" }] }),
  ];

  it("filters by status, category, contribution (미정 = null) and search", () => {
    expect(titles(L.filterList(list, f({ statuses: ["pending", "adopted"] })))).toEqual(["A", "B", "E"]);
    expect(titles(L.filterList(list, f({ category: "대회·CTF" })))).toEqual(["A"]);
    expect(titles(L.filterList(list, f({ contribs: ["직접 수행", "미정"] })))).toEqual(["B", "C", "D", "E"]);
    expect(titles(L.filterList(list, f({ q: "pytorch" })))).toEqual(["B"]);
    expect(titles(L.filterList(list, f({ q: "vm 역공" })))).toEqual(["A"]);
    expect(titles(L.filterList(list, f({ q: "92%" })))).toEqual(["C"]);
    expect(L.filterList(list, f({ statuses: [] }))).toEqual([]);
  });

  it("todo filter replaces the status filter; counts", () => {
    expect(L.todoCounts(list)).toEqual({ decide: 1, answer: 1, apply: 2 });
    expect(titles(L.filterList(list, f({ statuses: ["excluded"], todo: "apply" })))).toEqual(["C", "E"]);
    expect(titles(L.filterList(list, f({ todo: "answer" })))).toEqual(["B"]);
    expect(titles(L.filterList(list, f({ todo: "decide", contribs: ["직접 수행"] })))).toEqual([]);
  });

  it("groups by category in fixed order and by year with no-period last", () => {
    const xs = [
      x("old", { period: "2021-03 ~ 2021-06", category: "교육·수업" }),
      x("none", { category: "프로젝트" }),
      x("new", { period: "2025-01 ~ 2025-11", category: "프로젝트" }),
      x("mid", { period: "2025-03", category: "연구" }),
      x("yr", { period: "2023", category: "프로젝트" }),
    ];
    const byCat = L.groupList(xs, "category");
    expect(byCat.map((g) => g.label)).toEqual(["프로젝트", "연구", "교육·수업"]);
    expect(titles(byCat[0].items)).toEqual(["new", "yr", "none"]);
    const byYear = L.groupList(xs, "year");
    expect(byYear.map((g) => g.label)).toEqual(["2025년", "2023년", "2021년", "기간 없음"]);
    expect(titles(byYear[0].items)).toEqual(["new", "mid"]);
    expect(byYear.at(-1)!.key).toBe("y-none");
    expect(new Set(byYear.map((g) => g.key)).size).toBe(byYear.length);
  });

  it("chips fall back to the first metric (24 chars) when there is no outcome keyword", () => {
    const long = "가".repeat(30);
    expect(L.chipsOf(x("a", { metrics: [long, "b"] })).fallback).toBe("가".repeat(23) + "…");
    expect(L.chipsOf(x("a", { metrics: ["짧은 성과"] })).fallback).toBe("짧은 성과");
    expect(L.chipsOf(x("a", { outcome_keywords: ["키 12벌 복원"], metrics: ["m"] }))).toEqual({ kw: [], out: ["키 12벌 복원"], fallback: null });
    expect(L.chipsOf(x("a")).fallback).toBeNull();
    expect(L.outMark("키 12벌 복원")).toBe("▲");
    expect(L.outMark("취약점 신고")).toBe("✓");
  });

  it("oneLine: 제목 (기간) — 역할 · 성과, falls back to team size, omits empty parts", () => {
    expect(L.oneLine(x("A", { period: "2026-11", role: "팀장 (팀 3명)", metrics: ["입력 64자 복원", "키 12벌"] }))).toBe("A (2026-11) — 팀장 (팀 3명) · 입력 64자 복원, 키 12벌");
    expect(L.oneLine(x("A", { team: "개인" }))).toBe("A — 팀 규모 개인");
    expect(L.oneLine(x("B"))).toBe("B");
    expect(L.starText(x("S", { star: { s: "1", t: "2", a: "3", r: "4" } }))).toBe("Situation: 1\nTask: 2\nAction: 3\nResult: 4");
    expect(L.splitList(" a, ,b ,")).toEqual(["a", "b"]);
    expect(L.splitList("x, y\nz", "\n")).toEqual(["x, y", "z"]);
  });
});

describe("setup & settings logic (11.6)", () => {
  const F = (path: string, kind = "documents", checked = true) => ({ path, label: path, kind, checked });

  it("addFolderTo puts a new folder on top checked; existing one moves to top and gets checked", () => {
    const list = [F("/a"), F("/b", "keyword", false)];
    expect(L.addFolderTo(list, " /c ").map((f) => [f.path, f.kind, f.checked])).toEqual([["/c", "manual", true], ["/a", "documents", true], ["/b", "keyword", false]]);
    expect(L.addFolderTo(list, "/b/").map((f) => [f.path, f.kind, f.checked])).toEqual([["/b", "keyword", true], ["/a", "documents", true]]);
    expect(L.addFolderTo([F("C:\\Users\\A")], "c:/users/a")).toHaveLength(1);
    expect(L.addFolderTo(list, "  ")).toEqual(list);
  });

  it("mergeFolders keeps user state and appends only new suggestions", () => {
    const list = [F("/m", "manual"), F("/a", "documents", false)];
    const merged = L.mergeFolders(list, [F("/a"), F("/k", "keyword", false), F("/k", "keyword")]);
    expect(merged.map((f) => [f.path, f.checked])).toEqual([["/m", true], ["/a", false], ["/k", false]]);
  });

  it("groupFolders orders groups (manual, base, cloud, drive, keyword) and drops empty ones", () => {
    const g = L.groupFolders([F("/k", "keyword"), F("/d", "desktop"), F("/x", "weird"), F("/o", "cloud"), F("/dl", "downloads")]);
    expect(g.map((x) => [x.key, x.items.map((i) => i.path)])).toEqual([["manual", ["/x"]], ["base", ["/d", "/dl"]], ["cloud", ["/o"]], ["keyword", ["/k"]]]);
    expect(L.newSuggestions([F("/a"), F("/b")], ["/a/"]).map((f) => f.path)).toEqual(["/b"]);
    // WSL: \\wsl$\ 와 \\wsl.localhost\ 는 같은 폴더
    expect(L.newSuggestions([F("\\\\wsl.localhost\\Ubuntu\\home\\yh\\projects", "wsl")], ["\\\\wsl$\\Ubuntu\\home\\yh\\projects\\"])).toEqual([]);
    expect(L.groupFolders([F("/w", "wsl"), F("/k", "keyword")]).map((x: any) => x.key)).toEqual(["wsl", "keyword"]);
  });

  it("wizardErrors and setupPayload", () => {
    const w = { university: " 연세대 ", keywords: [{ text: "연세대", checked: true }, { text: "Yonsei", checked: false }], folders: [F("/a", "documents", false)], planScale: 5, output: "" };
    expect(L.wizardErrors(1, w)).toEqual([]);
    expect(L.wizardErrors(2, w)).toEqual(["스캔할 폴더를 하나 이상 고르세요"]);
    expect(L.wizardErrors(3, w)).toEqual(["결과 폴더를 입력하세요"]);
    expect(L.wizardErrors(3, { ...w, output: "/o", planScale: 3 })).toEqual(["요금제를 고르세요"]);
    w.folders.push(F("/b"));
    expect(L.wizardErrors(2, w)).toEqual([]);
    expect(L.setupPayload({ ...w, output: " /o " })).toEqual({ university: "연세대", keywords: ["연세대"], folders: ["/b"], planScale: 5, output: "/o", dismissed: [] });
    // 체크를 끈 클라우드·드라이브·WSL 제안만 "다시 묻지 않음"으로(기본 폴더·이름 검색 결과는 아님)
    const w2 = { ...w, output: "/o", folders: [F("/d", "drive", false), F("/c", "cloud", false), F("/w", "wsl", true), F("/k", "keyword", false), F("/x", "documents", false)] };
    expect(L.setupPayload(w2).dismissed).toEqual(["/d", "/c"]);
  });

  it("pctToShare clamps to 5–100% and settingsDiff sends only changed fields", () => {
    expect([L.pctToShare("30"), L.pctToShare(1), L.pctToShare("250"), L.pctToShare(""), L.pctToShare("x")]).toEqual([0.3, 0.05, 1, null, null]);
    const base = { scanFolders: ["/a"], planScale: 1, fiveHourShare: 0.3, keywords: "연세대, Yonsei" };
    expect(L.settingsDiff({ ...base, keywords: "연세대 ,Yonsei" }, base)).toEqual({});
    expect(L.settingsDiff({ ...base, planScale: 5, fiveHourShare: 0.5 }, base)).toEqual({ planScale: 5, fiveHourShare: 0.5 });
    expect(L.settingsDiff({ ...base, scanFolders: ["/a", "/b"], keywords: "연세대" }, base)).toEqual({ scanFolders: ["/a", "/b"], keywords: ["연세대"] });
  });

  it("filterScope searches path and Korean labels, sorted by path; checkMark", () => {
    const rows = [
      { path: "/z/proj", decision: "include", by: "llm", at: "2026-11-20" },
      { path: "/a/games", decision: "exclude", by: "user", at: "2026-11-21" },
    ];
    expect(L.filterScope(rows, "").map((r) => r.path)).toEqual(["/a/games", "/z/proj"]);
    expect(L.filterScope(rows, "제외").map((r) => r.path)).toEqual(["/a/games"]);
    expect(L.filterScope(rows, "llm 포함").map((r) => r.path)).toEqual(["/z/proj"]);
    expect(L.filterScope(rows, "PROJ").map((r) => r.path)).toEqual(["/z/proj"]);
    expect([L.checkMark({ ok: true }), L.checkMark({ ok: false, warn: true }), L.checkMark({ ok: false })]).toEqual(["ok", "warn", "fail"]);
  });

  it("completeness: average of 4 fields over adopted experiences only", () => {
    expect(L.completeness([])).toEqual({ pct: 0, adopted: 0, missing: { period: 0, contribution: 0, star: 0, keywords: 0 } });
    const full = { review: "adopted", period: "2026-10", contribution: "직접 수행", star: { s: "s", t: "", a: "", r: "" }, keywords: ["x"] };
    const half = { review: "adopted", period: null, contribution: "AI 주도", star: null, keywords: ["y"] };
    const pending = { review: "pending", period: null, contribution: null, star: null, keywords: [] };
    expect(L.completeness([full, half, pending] as any)).toEqual({ pct: 75, adopted: 2, missing: { period: 1, contribution: 0, star: 1, keywords: 0 } });
  });

  it("routeOf: hash → view; anchors fall back to the experience list", () => {
    expect(["", "#", "#/"].map(L.routeOf)).toEqual(["home", "home", "home"]);
    expect(["#/exp", "#/master", "#/help", "#/exp?x", "#프로젝트", "#/nope"].map(L.routeOf)).toEqual(["exp", "master", "help", "exp", "exp", "exp"]);
  });
});
