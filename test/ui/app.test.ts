import { describe, it, expect } from "vitest";
import { renderApp } from "../../src/ui/app.js";
import { adoptedOnly, type UiExperience } from "../../src/ui/model.js";

const x = (title: string, over: Partial<UiExperience> = {}): UiExperience => ({
  rel: `experiences/${title}.md`, title, category: "프로젝트", period: "2025-03", org: null, role: null, team: null, contribution: "직접 수행",
  skills: ["Python"], metrics: ["정확도 92%"], star: { s: "s", t: "t", a: "a", r: "r" }, evidence: [{ path: "files/a.md", title: "근거" }],
  review: "adopted", value: "상", questions: [{ id: "q1", field: "role", q: "역할?", a: "비밀 답" }], pending_apply: false, edited: false,
  keywords: ["VM 역공학"], outcome_keywords: ["키 12벌 복원"], raw: { period: "2025-03", role: null, team_size: null, category: null, metrics: ["정확도 92%"] }, ...over,
});
const scripts = (html: string) => [...html.matchAll(/<script(?![^>]*application\/json)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const dataOf = (html: string) => JSON.parse(html.match(/<script type="application\/json" id="data">([\s\S]*?)<\/script>/)![1]);

describe("renderApp (11.5)", () => {
  const evil = x("</script><script>alert(1)</script>\u2028줄\u2029끝", { org: "<!--" });
  const html = renderApp({ mode: "static", data: adoptedOnly([evil, x("보류됨", { review: "held" }), x("정상")]), generatedAt: "2026-11-24 19:10" });

  it("static: data JSON is escaped, parses, contains adopted only, and drops Q/A", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html.match(/<\/script>/g)).toHaveLength(2); // data + app 스크립트의 닫는 태그만
    expect(html).not.toContain("<!--");
    expect(html.includes("\u2028") || html.includes("\u2029")).toBe(false);
    const d = dataOf(html);
    expect(d.generatedAt).toBe("2026-11-24 19:10");
    expect(d.experiences.map((e: UiExperience) => e.title)).toEqual([evil.title, "정상"]);
    expect(d.experiences[0].questions).toEqual([]);
    expect(html).not.toContain("비밀 답");
  });

  it("has no external resources and the app script compiles", () => {
    expect(html).not.toMatch(/(src|href)\s*=\s*["']?(https?:)?\/\//i);
    expect(html).not.toMatch(/@import|url\(/i);
    const s = scripts(html);
    expect(s).toHaveLength(1);
    expect(() => new Function(s[0])).not.toThrow();
    expect(s[0]).toContain('var MODE = "static"');
    expect(s[0]).toContain("var TOKEN = null");
    expect(s[0]).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  });

  it("live: embeds the token, fetches /api/state with the header, no data block", () => {
    const live = renderApp({ mode: "live", token: "abc123" });
    expect(live).not.toContain('id="data"');
    const [s] = scripts(live);
    expect(() => new Function(s)).not.toThrow();
    expect(s).toContain('var TOKEN = "abc123"');
    expect(s).toContain('api("GET", "/api/state")');
    expect(s).toContain('"X-MP-Token": TOKEN');
    expect(live).toContain('id="jobbar"');
    expect(html).not.toContain('id="jobbar"');
  });

  it("live includes the setup wizard and settings (11.6); static does not", () => {
    const live = renderApp({ mode: "live", token: "abc123" });
    const [s] = scripts(live);
    expect(() => new Function(s)).not.toThrow();
    expect(s).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
    expect(s).not.toMatch(/\b(alert|confirm|prompt)\(/);
    expect(live).toContain('id="setup"');
    expect(live).toContain('id="settings"');
    for (const p of ["/api/setup", "/api/setup/suggest?university=", "/api/pick-folder", "/api/check", "/api/settings", "/api/settings/scope-reset"]) expect(s).toContain(p);
    // 외부 리소스를 불러오지 않는다(설치 안내의 명령어 문자열은 허용)
    expect(live).not.toMatch(/(src|href)\s*=\s*["']?(https?:)?\/\/|url\(\s*["']?https?:|@import/i);
    expect(live.match(/<\/script>/g)).toHaveLength(1);
    expect(html).not.toContain('id="setup"');
    expect(html).not.toContain('id="settings"');
    expect(html).not.toContain("/api/setup");
    expect(html).not.toContain(".overlay");
    expect(scripts(html)[0]).not.toMatch(/\b(alert|confirm|prompt)\(/);
  });
});
