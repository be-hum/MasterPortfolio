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
