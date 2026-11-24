import { describe, it, expect } from "vitest";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { mkTmp } from "../helpers/tmp.js";
import { emptyState, loadState } from "../../src/store/state.js";
import { sha256String } from "../../src/core/hash.js";
import { createExperience, listExperiences, saveExperience, parseStar, renderExperienceBody } from "../../src/store/experiences.js";
import type { ExperienceFrontmatter } from "../../src/core/schema.js";

const fm = (title: string): ExperienceFrontmatter => ({
  schema_version: 1, kind: "experience", title, type: "보고서", period: null, org: null, role: null, team_size: null, contribution: null, category: null,
  skills: [], metrics: [], value: "중", value_reason: null, evidence: ["files/a.md"], in_resume: "판단불가",
  review: "pending", questions: [{ id: "q1", field: "role", q: "본인 역할은?", a: null }], pending_apply: false,
  reviewed_at: null, agent: "claude", generated_at: "2026-11-24T10:00:00+09:00",
});

describe("experience store (10.3)", () => {
  it("creates cards with unique names and records their hash", async () => {
    const out = await mkTmp(); const st = emptyState();
    const a = await createExperience(out, st, fm("캡스톤 디자인"));
    const b = await createExperience(out, st, fm("캡스톤 디자인"));
    expect(a).toMatch(/^experiences\/캡스톤-디자인-[0-9a-f]{6}\.md$/);
    expect(b).not.toBe(a);
    expect(Object.keys(st.experiences).sort()).toEqual([a, b].sort());
    const text = await readFile(join(out, a), "utf8");
    expect(text).toContain("## STAR 요약");
    expect(text).toContain("## 질의응답");
  });

  it("lists cards, flags user edits, and refuses to save over an edited card", async () => {
    const out = await mkTmp(); const st = emptyState();
    const rel = await createExperience(out, st, fm("A"));
    let [e] = await listExperiences(out, st);
    expect(e.edited).toBe(false);
    const ok = await saveExperience(out, st, e, { ...e.fm, review: "adopted" });
    expect(ok).toEqual({ ok: true });
    [e] = await listExperiences(out, st);
    expect(e.fm.review).toBe("adopted");
    await writeFile(join(out, rel), (await readFile(join(out, rel), "utf8")) + "\n사용자 메모\n");
    [e] = await listExperiences(out, st);
    expect(e.edited).toBe(true);
    expect(await saveExperience(out, st, e, { ...e.fm, review: "held" })).toEqual({ skipped: "edited" });
    expect(await readFile(join(out, rel), "utf8")).toContain("사용자 메모");
  });

  it("round-trips the STAR section and renders answered questions", () => {
    const star = { s: "상황", t: "과제", a: "행동", r: "결과" };
    const body = renderExperienceBody(star, [{ id: "q1", field: "role", q: "역할?", a: "팀장" }, { id: "q2", field: "metrics", q: "성과?", a: null }]);
    expect(parseStar(body)).toEqual(star);
    expect(body).toContain("- Q: 역할?\n  A: 팀장");
    expect(body).not.toContain("성과?");
    expect(parseStar(renderExperienceBody(null, []))).toBeNull();
  });

  it("persists state.json together with every card write (C1)", async () => {
    const out = await mkTmp(); const st = emptyState();
    const rel = await createExperience(out, st, fm("A"));
    let disk = (await loadState(out)).state;
    expect(disk.experiences[rel].card_body_hash).toBe(sha256String(await readFile(join(out, rel), "utf8")));
    const [e] = await listExperiences(out, st);
    expect(await saveExperience(out, st, e, { ...e.fm, review: "adopted" })).toEqual({ ok: true });
    disk = (await loadState(out)).state;
    const [again] = await listExperiences(out, disk);
    expect(again.edited).toBe(false);
    expect(again.fm.review).toBe("adopted");
  });

  it("skips files that are not experience cards", async () => {
    const out = await mkTmp(); const st = emptyState();
    await createExperience(out, st, fm("A"));
    await writeFile(join(out, "experiences", "broken.md"), "---\nkind: file\n---\n");
    expect((await listExperiences(out, st)).map((e) => e.fm.title)).toEqual(["A"]);
    expect((await readdir(join(out, "experiences"))).length).toBe(2);
  });

  it("reads old cards without contribution/category as null", async () => {
    const out = await mkTmp(); const st = emptyState();
    const rel = await createExperience(out, st, fm("A"));
    const txt = (await readFile(join(out, rel), "utf8")).split("\n").filter((l) => !/^(contribution|category):/.test(l)).join("\n");
    expect(txt).not.toContain("contribution:");
    await writeFile(join(out, rel), txt);
    const [e] = await listExperiences(out, st);
    expect(e.fm.contribution).toBeNull();
    expect(e.fm.category).toBeNull();
  });
});
