import { describe, it, expect } from "vitest";
import { renderMaster } from "../../src/store/masterMd.js";
import type { LoadedExperience } from "../../src/store/experiences.js";
import type { ExperienceFrontmatter } from "../../src/core/schema.js";

const exp = (title: string, over: Partial<ExperienceFrontmatter> = {}, star = true): LoadedExperience => ({
  rel: `experiences/${title}.md`, body: "", edited: false,
  star: star ? { s: "S", t: "T", a: "A", r: "R" } : null,
  fm: {
    schema_version: 1, kind: "experience", title, type: "보고서", period: null, org: null, role: null, team_size: null, contribution: null, category: null, skills: [], metrics: [],
    value: "상", value_reason: null, evidence: ["files/a.md"], in_resume: "판단불가", review: "adopted", questions: [], pending_apply: false,
    reviewed_at: null, agent: "claude", generated_at: "x", ...over,
  },
});

describe("renderMaster (11.3)", () => {
  it("includes adopted only, groups by category, newest first, and marks broken evidence", () => {
    const md = renderMaster([
      exp("오래된", { period: "2023-03 ~ 2023-06" }),
      exp("최근", { period: "2025-03 ~ 2025-06", role: "팀장", team_size: 4, skills: ["Python"], metrics: ["정확도 92%"], evidence: ["files/a.md", "files/gone.md"] }),
      exp("보류됨", { review: "held" }),
      exp("발표", { type: "발표", category: "연구" }, false),
    ], new Map([["files/a.md", "캡스톤 보고서"], ["files/gone.md", null]]));
    expect(md).toContain("자동 생성");
    expect(md.indexOf("## 프로젝트")).toBeLessThan(md.indexOf("## 연구"));
    expect(md.indexOf("### 최근")).toBeLessThan(md.indexOf("### 오래된"));
    expect(md).not.toContain("보류됨");
    expect(md).toContain("- 역할: 팀장 (팀 4명)");
    expect(md).toContain("[캡스톤 보고서](files/a.md)");
    expect(md).toContain("gone.md (카드 없음)");
    expect(md).not.toContain("(미상)");
    const 발표 = md.slice(md.indexOf("### 발표"));
    expect(발표).not.toContain("STAR");
  });
  it("infers categories and normalizes display", () => {
    const md = renderMaster([
      exp("워게임 리버싱: VM 기반 암호 역분석"),
      exp("랩 일", { org: "보안 Lab" }),
      exp("수업 건", { type: "과제" }),
      exp("모임", { org: "학술 동아리" }),
      exp("일반"),
    ], new Map([["files/a.md", "A"]]));
    const at = (h: string) => md.indexOf(h);
    expect(at("## 프로젝트")).toBeLessThan(at("## 연구"));
    expect(at("## 연구")).toBeLessThan(at("## 대회·CTF"));
    expect(at("## 대회·CTF")).toBeLessThan(at("## 교육·수업"));
    expect(at("## 교육·수업")).toBeLessThan(at("## 동아리·스터디"));
    expect(at("## 대회·CTF")).toBeLessThan(at("### 워게임"));
    expect(at("### 워게임")).toBeLessThan(at("## 교육·수업"));
    expect(at("## 연구")).toBeLessThan(at("### 랩 일"));
    expect(at("### 랩 일")).toBeLessThan(at("## 대회·CTF"));
    expect(at("### 수업 건")).toBeGreaterThan(at("## 교육·수업"));
    expect(at("### 모임")).toBeGreaterThan(at("## 동아리·스터디"));
    expect(at("## 프로젝트")).toBeLessThan(at("### 일반"));
    expect(at("### 일반")).toBeLessThan(at("## 연구"));
  });
  it("collapses period, solo team, contribution, doc-stat metrics", () => {
    const md = renderMaster([
      exp("a", { period: "2024-01 ~ 2024-01", role: "개인 프로젝트 (단독 개발)", team_size: 1, contribution: "AI 주도", metrics: ["슬라이드 17장", "Header file 13개", "정확도 92%", "참고 자료 14건"] }),
      exp("b", { role: "분석", team_size: 1, metrics: ["슬라이드 17장"] }),
      exp("c", { team_size: 1 }),
    ], new Map([["files/a.md", "A"]]));
    expect(md).toContain("- 기간: 2024-01\n");
    expect(md).toContain("- 역할: 개인 프로젝트 (단독 개발)\n- 수행 방식: AI 주도");
    expect(md).not.toContain("(팀 1명)");
    expect(md).toContain("- 성과: 정확도 92%\n");
    expect(md).toContain("- 역할: 분석 (개인)");
    expect(md).toContain("- 팀 규모: 개인");
    const b = md.slice(md.indexOf("### b"), md.indexOf("### c"));
    expect(b).not.toContain("성과");
  });
  it("uses evidence card titles (write-up) to infer 대회·CTF", () => {
    const md = renderMaster([exp("LINKER: VM 역방향 실행으로 입력 복원", { evidence: ["files/w.md"] })],
      new Map([["files/w.md", "LINKER write-up: VM 역산"]]));
    expect(md).toContain("## 대회·CTF");
    expect(md).not.toContain("## 프로젝트");
  });

  it("keeps real achievements that start with a doc word; drops pure doc stats", () => {
    const md = renderMaster([exp("x", { metrics: ["파일 1,000개 일괄 변환 자동화", "페이지 3개 반응형 구현", "상장 1장", "Header file 13개, Source file 8개 구성", "120쪽"] })], new Map([["files/a.md", "a"]]));
    expect(md).toContain("- 성과: 파일 1,000개 일괄 변환 자동화, 페이지 3개 반응형 구현, 상장 1장");
    expect(md).not.toContain("Header file");
    expect(md).not.toContain("120쪽");
  });

  it("renders an empty record with a hint when nothing is adopted", () => {
    expect(renderMaster([], new Map())).toContain("채택된 경험이 없습니다");
  });
});
