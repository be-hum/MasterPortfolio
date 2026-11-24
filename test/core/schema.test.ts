import { describe, it, expect } from "vitest";
import { FileExtraction, FileCardFrontmatter, JudgeResult, ExperienceFrontmatter, State } from "../../src/core/schema.js";

const valid = {
  id: "f1", type: "보고서", use_for: ["포트폴리오"], title: "최종 보고서",
  summary: "요약", detail: "상세", excerpts: ["문장"], period: "2025-03 ~ 2025-06",
  role: null, skills: ["Python"], metrics: ["정확도 92%"], org: null, in_resume: "판단불가",
};

describe("FileExtraction", () => {
  it("accepts a valid item without value fields (extract stage, §9.6)", () => {
    const r = FileExtraction.safeParse(valid);
    expect(r.success).toBe(true);
    expect(r.success && "value" in r.data).toBe(false);
  });
  it("rejects unknown type", () => { expect(FileExtraction.safeParse({ ...valid, type: "일기" }).success).toBe(false); });
  it("trims extra excerpts to 1 instead of rejecting (§9.7 D)", () => {
    const r = FileExtraction.safeParse({ ...valid, excerpts: ["a", "b", "c", "d"] });
    expect(r.success && r.data.excerpts).toEqual(["a"]);
  });
});

describe("FileCardFrontmatter value", () => {
  const fm = {
    schema_version: 1, kind: "file", source: "/a.md", source_hash: "sha256:x", format: "md", size: 1, modified: "2025-01-01",
    duplicates: [], type: "보고서", use_for: [], title: "t", summary: "s", period: null, role: null, skills: [], metrics: [], org: null,
    value: null, value_reason: null, in_resume: "판단불가", agent: "claude", generated_at: "2026-11-24T10:00:00+09:00",
  };
  it("allows null (= 미판정)", () => { expect(FileCardFrontmatter.safeParse(fm).success).toBe(true); });
  it("still accepts 상/중/하 and rejects other values", () => {
    expect(FileCardFrontmatter.safeParse({ ...fm, value: "상", value_reason: "r" }).success).toBe(true);
    expect(FileCardFrontmatter.safeParse({ ...fm, value: "최상", value_reason: "r" }).success).toBe(false);
  });
});

describe("JudgeResult", () => {
  it("validates id, value and reason", () => {
    expect(JudgeResult.safeParse({ id: "c1", value: "중", value_reason: "근거" }).success).toBe(true);
    expect(JudgeResult.safeParse({ id: "c1", value: "최상", value_reason: "근거" }).success).toBe(false);
    expect(JudgeResult.safeParse({ id: "c1", value: "상" }).success).toBe(false);
  });
});

describe("ExperienceFrontmatter (10.3)", () => {
  const base = {
    schema_version: 1, kind: "experience", title: "캡스톤", type: "보고서", period: "2025-03 ~ 2025-06", org: null, role: null,
    team_size: null, contribution: null, category: null, skills: ["Python"], metrics: [], value: "상", value_reason: null, evidence: ["files/a.md"],
    in_resume: "판단불가", review: "pending", questions: [{ id: "q1", field: "role", q: "본인 역할은?", a: null }],
    reviewed_at: null, agent: "claude", generated_at: "2026-11-24T10:00:00+09:00",
  };
  it("parses the spec example and defaults pending_apply to false", () => {
    const fm = ExperienceFrontmatter.parse(base);
    expect(fm.pending_apply).toBe(false);
    expect(fm.questions[0].a).toBeNull();
  });
  it("rejects unknown review states and question fields", () => {
    expect(ExperienceFrontmatter.safeParse({ ...base, review: "done" }).success).toBe(false);
    expect(ExperienceFrontmatter.safeParse({ ...base, questions: [{ id: "q1", field: "salary", q: "?", a: null }] }).success).toBe(false);
  });
});

describe("State.experiences", () => {
  it("defaults to an empty map so old state.json files still load", () => {
    const s = State.parse({ schema_version: 1, files: {}, last_scan: null });
    expect(s.experiences).toEqual({});
  });
  it("accepts grouping: ungrouped on a file entry", () => {
    const s = State.parse({ schema_version: 1, last_scan: null, files: { "/a": { source_hash: "h", card: "files/a.md", card_body_hash: "x", card_snapshot: {}, status: "done", grouping: "ungrouped" } } });
    expect(s.files["/a"].grouping).toBe("ungrouped");
  });
});
