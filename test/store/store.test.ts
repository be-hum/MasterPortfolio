import { describe, it, expect, afterAll } from "vitest";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { slugify, cardFileName } from "../../src/store/slug.js";
import { stringifyCard, parseCard } from "../../src/store/frontmatter.js";
import { loadState, saveState } from "../../src/store/state.js";
import { writeFileCard, localDate, setCardJudgement } from "../../src/store/cards.js";
import { sha256String } from "../../src/core/hash.js";
import { rm } from "node:fs/promises";
import { writeIndex } from "../../src/store/indexMd.js";
import { writeScanReport } from "../../src/store/report.js";
import { FileCardFrontmatter } from "../../src/core/schema.js";
import { mkTmp } from "../helpers/tmp.js";

const analysis = {
  id: "f1", type: "보고서" as const, use_for: ["포트폴리오" as const], title: "이미지 분류: 최종/보고서?",
  summary: "요약", detail: "상세 1\n상세 2", excerpts: ["핵심 문장"], period: "2025-03 ~ 2025-06",
  role: "팀장", skills: ["Python"], metrics: ["정확도 92%"], org: null, in_resume: "판단불가" as const,
};

describe("slug", () => {
  it("keeps Korean, strips unsafe chars, limits to 40 chars (Review Focus 1)", () => {
    expect(slugify("이미지 분류: 최종/보고서?")).toBe("이미지-분류-최종-보고서");
    expect([...slugify("가".repeat(60))].length).toBe(40);
    expect(slugify("CON")).toBe("CON-");
  });
  it("builds file name from period year and hash", () => {
    expect(cardFileName({ period: "2025-03 ~ 2025-06", modified: "2026-01-01", title: "보고서", source_hash: "sha256:abcdef123" }))
      .toBe("2025-보고서-abcdef.md");
    expect(cardFileName({ period: null, modified: "2024-05-01", title: "x", source_hash: "sha256:000000ff" }))
      .toBe("2024-x-000000.md");
  });
});

describe("frontmatter", () => {
  it("round-trips", () => {
    const t = stringifyCard({ a: 1, b: ["x"], c: null }, "## 본문\n내용");
    expect(parseCard(t)).toEqual({ fm: { a: 1, b: ["x"], c: null }, body: "## 본문\n내용" });
  });
});

describe("state", () => {
  it("reports missing and corrupt", async () => {
    const d = await mkTmp();
    expect((await loadState(d)).problem).toBe("missing");
    await mkdir(join(d, ".mp"), { recursive: true });
    await writeFile(join(d, ".mp", "state.json"), "{not json");
    expect((await loadState(d)).problem).toBe("corrupt");
  });
  it("round-trips", async () => {
    const d = await mkTmp();
    const s = { schema_version: 1 as const, files: {}, experiences: {}, last_scan: "2026-11-24T00:00:00+09:00" };
    await saveState(d, s);
    expect(await loadState(d)).toEqual({ state: s, problem: null });
  });
});

describe("writeFileCard", () => {
  it("writes a valid card with normalized source path (Review Focus 2)", async () => {
    const d = await mkTmp();
    const cand = { path: "C:\\Users\\k\\a.pdf", key: "C:/Users/k/a.pdf", format: "pdf" as const, size: 10, mtimeMs: Date.parse("2025-06-20"), hash: "sha256:abcdef99", duplicates: [] };
    const { relPath, entry } = await writeFileCard(d, cand, analysis, "claude");
    expect(relPath).toBe("files/2025-이미지-분류-최종-보고서-abcdef.md");
    const { fm, body } = parseCard(await readFile(join(d, relPath), "utf8"));
    expect(FileCardFrontmatter.safeParse(fm).success).toBe(true);
    expect(fm.source).toBe("C:/Users/k/a.pdf");
    expect(body).toContain("## 상세 요약");
    expect(body).toContain("- 핵심 문장");
    expect(entry.status).toBe("done");
    expect(entry.card_body_hash).toMatch(/^sha256:/);
    // 1단계 직후 카드는 미판정(9.6)
    expect(fm.value).toBeNull();
    expect(fm.value_reason).toBeNull();
  });
  it("does not overwrite an existing card with the same name", async () => {
    const d = await mkTmp();
    const cand = { path: "/a.pdf", key: "/a.pdf", format: "pdf" as const, size: 1, mtimeMs: 0, hash: "sha256:abcdef00", duplicates: [] };
    const r1 = await writeFileCard(d, cand, analysis, "claude");
    const r2 = await writeFileCard(d, { ...cand, path: "/b.pdf", key: "/b.pdf" }, analysis, "claude");
    expect(r2.relPath).not.toBe(r1.relPath);
  });
});

describe("index and report", () => {
  it("writes index grouped by type and a report listing absolute paths", async () => {
    const d = await mkTmp();
    const cand = { path: "/a.pdf", key: "/a.pdf", format: "pdf" as const, size: 1, mtimeMs: 0, hash: "sha256:abcdef00", duplicates: [] };
    await writeFileCard(d, cand, analysis, "claude");
    await writeIndex(d);
    const idx = await readFile(join(d, "index.md"), "utf8");
    expect(idx).toContain("## 보고서");
    expect(idx).toContain("이미지 분류");
    const rel = await writeScanReport(d, {
      startedAt: "2026-11-24T10:00:00+09:00", created: ["files/x.md"], changed: [], skippedSensitive: [],
      skippedLarge: [{ path: "D:/영상/발표.pptx", size: 60_000_000 }], skippedLong: [{ path: "D:/논문.pdf", chars: 120000 }],
      extractFailed: [], analysisFailed: [], inaccessible: [], unsupported: 3, stoppedReason: null,
    });
    expect(rel).toBe("reports/scan-2026-11-24-1000.md");
    const rel2 = await writeScanReport(d, { startedAt: "2026-11-24T10:00:30+09:00", created: [], changed: ["a\nb"], skippedSensitive: [], skippedLarge: [{ path: "/x/a`b.pdf", size: 1 }], skippedLong: [], extractFailed: [], analysisFailed: [], inaccessible: [], unsupported: 0, stoppedReason: null });
    expect(rel2).toBe("reports/scan-2026-11-24-1000-2.md");
    const rep2 = await readFile(join(d, rel2), "utf8");
    expect(rep2).toContain("- a b");
    expect(rep2).toContain("`a\\`b.pdf`");
    expect(rep2).toContain("## 원본 변경 — 다음 버전에서 `mp rescan`으로 다시 처리 예정 (1)");
    expect(rep2).not.toContain("`mp rescan <경로>`로 다시 처리");
    const rep = await readFile(join(d, rel), "utf8");
    expect(rep).toContain("D:/영상/발표.pptx");
    expect(rep).toContain("발표.pptx");
    expect(rep).toContain("D:/논문.pdf");
    expect(rep).toContain("120,000");
  });
});

describe("index robustness and escaping", () => {
  const cand = { path: "/a.pdf", key: "/a.pdf", format: "pdf" as const, size: 1, mtimeMs: 0, hash: "sha256:abcdef00", duplicates: [] };
  it("survives broken and unknown-type cards", async () => {
    const d = await mkTmp();
    await writeFileCard(d, cand, analysis, "claude");
    await writeFile(join(d, "files", "broken.md"), "---\na: [unclosed\n---\nbody");
    await writeFile(join(d, "files", "odd.md"), stringifyCard({ type: "없는유형", title: "이상한" }, "x"));
    await writeIndex(d);
    const idx = await readFile(join(d, "index.md"), "utf8");
    expect(idx).toContain("이미지 분류");
    expect(idx).toContain("## 읽을 수 없는 카드");
    expect(idx).toContain("(files/broken.md)");
    expect(idx).toContain("## 기타(분류 불명)");
    expect(idx).toContain("이상한");
  });
  it("escapes markdown in cells", async () => {
    const d = await mkTmp();
    const titles = ["a]b", "a\\|b", "<script>x</script>", "a\r\nb"];
    for (const [i, t] of titles.entries()) await writeFileCard(d, { ...cand, hash: `sha256:00000${i}ff` }, { ...analysis, title: t }, "claude");
    await writeIndex(d);
    const idx = await readFile(join(d, "index.md"), "utf8");
    const rows = idx.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| 가치"));
    expect(rows).toHaveLength(4);
    for (const r of rows) expect(r.split(/(?<!\\)\|/).length - 2).toBe(5);
    expect(idx).toContain("[a\\]b]");
    expect(idx).toContain("[a\\\\\\|b]");
    expect(idx).toContain("\\<script\\>x\\</script\\>");
    expect(idx).toContain("[a b]");
  });
  it("localDate uses local getters", () => {
    const ms = Date.parse("2025-06-20T23:30:00Z"), d = new Date(ms);
    expect(localDate(ms)).toBe(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  });
});

describe("setCardJudgement (§9.6)", () => {
  const cand = { path: "/a.pdf", key: "/a.pdf", format: "pdf" as const, size: 1, mtimeMs: 0, hash: "sha256:abcdef00", duplicates: [] };
  const dirs: string[] = [];
  const tmp = async () => { const d = await mkTmp(); dirs.push(d); return d; };
  afterAll(async () => { await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });

  it("changes only value/value_reason, keeps the body, and returns a new hash and snapshot", async () => {
    const d = await tmp();
    const { relPath, entry } = await writeFileCard(d, cand, analysis, "claude");
    const before = parseCard(await readFile(join(d, relPath), "utf8"));
    const r = await setCardJudgement(d, relPath, { id: "c1", value: "상", value_reason: "정량 성과가 명확" }, entry);
    expect("entry" in r).toBe(true);
    if (!("entry" in r)) return;
    const text = await readFile(join(d, relPath), "utf8");
    const after = parseCard(text);
    expect(after.body).toBe(before.body);
    expect(after.fm).toEqual({ ...before.fm, value: "상", value_reason: "정량 성과가 명확" });
    expect(Object.keys(after.fm)).toEqual(Object.keys(before.fm));
    expect(r.entry.card_body_hash).toBe(sha256String(text));
    expect(r.entry.card_snapshot).toEqual(after.fm);
    expect(r.entry).toMatchObject({ status: "done", card: relPath, source_hash: cand.hash });
  });

  it("skips a card the user edited (hash differs) or a protected card, leaving the file untouched", async () => {
    const d = await tmp();
    const { relPath, entry } = await writeFileCard(d, cand, analysis, "claude");
    const p = join(d, relPath);
    const edited = (await readFile(p, "utf8")).replace("상세 1", "사용자가 고친 줄");
    await writeFile(p, edited);
    expect(await setCardJudgement(d, relPath, { id: "c1", value: "상", value_reason: "r" }, entry)).toEqual({ skipped: "edited" });
    expect(await readFile(p, "utf8")).toBe(edited);

    const d2 = await tmp();
    const w = await writeFileCard(d2, cand, analysis, "claude");
    const prot = { ...w.entry, card_snapshot: { ...w.entry.card_snapshot, __protected: true } };
    const orig = await readFile(join(d2, w.relPath), "utf8");
    expect(await setCardJudgement(d2, w.relPath, { id: "c1", value: "상", value_reason: "r" }, prot)).toEqual({ skipped: "edited" });
    expect(await setCardJudgement(d2, w.relPath, { id: "c1", value: "상", value_reason: "r" }, { ...w.entry, card_body_hash: null })).toEqual({ skipped: "edited" });
    expect(await readFile(join(d2, w.relPath), "utf8")).toBe(orig);
  });
});

describe("index with unjudged cards (§9.6)", () => {
  it("puts unjudged cards at the bottom of their type section with 미판정", async () => {
    const d = await mkTmp();
    try {
      const base = { path: "/a.pdf", key: "/a.pdf", format: "pdf" as const, size: 1, mtimeMs: 0, duplicates: [] };
      const a = await writeFileCard(d, { ...base, hash: "sha256:aaaaaa00" }, { ...analysis, title: "가-미판정" }, "claude");
      const b = await writeFileCard(d, { ...base, hash: "sha256:bbbbbb00" }, { ...analysis, title: "나-하" }, "claude");
      const c = await writeFileCard(d, { ...base, hash: "sha256:cccccc00" }, { ...analysis, title: "다-상" }, "claude");
      await setCardJudgement(d, b.relPath, { id: "x", value: "하", value_reason: "r" }, b.entry);
      await setCardJudgement(d, c.relPath, { id: "x", value: "상", value_reason: "r" }, c.entry);
      expect(a.entry.card).toBeTruthy();
      await writeIndex(d);
      const rows = (await readFile(join(d, "index.md"), "utf8")).split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| 가치"));
      expect(rows.map((r) => r.split(" | ")[0])).toEqual(["| 상", "| 하", "| 미판정"]);
      expect(rows[2]).toContain("가-미판정");
    } finally { await rm(d, { recursive: true, force: true }); }
  });

  it("report shows 판정 완료 N / 미판정 M and the edited-card skip list", async () => {
    const d = await mkTmp();
    try {
      const rel = await writeScanReport(d, {
        startedAt: "2026-11-24T10:00:00+09:00", created: [], changed: [], skippedSensitive: [], skippedLarge: [], skippedLong: [],
        extractFailed: [], analysisFailed: [], inaccessible: [], unsupported: 0, stoppedReason: null,
        judgement: { judged: 3, unjudged: 2, skippedEdited: ["files/edited.md"] },
      });
      const rep = await readFile(join(d, rel), "utf8");
      expect(rep).toContain("판정 완료 3 / 미판정 2");
      expect(rep).toContain("## 편집된 카드라 판정 생략 (1)");
      expect(rep).toContain("files/edited.md");
    } finally { await rm(d, { recursive: true, force: true }); }
  });

  it("report shows the generated-output exclusion count and the triage drop list (§9.7 B·E)", async () => {
    const d = await mkTmp();
    try {
      const rel = await writeScanReport(d, {
        startedAt: "2026-11-24T10:00:00+09:00", created: [], changed: [], skippedSensitive: [], skippedLarge: [], skippedLong: [],
        extractFailed: [], analysisFailed: [], inaccessible: [], unsupported: 0, stoppedReason: null,
        generatedExcluded: 42, skippedIrrelevant: ["D:/강의/1주차.pdf"],
      });
      const rep = await readFile(join(d, rel), "utf8");
      expect(rep).toContain("생성물로 보여 제외 42개");
      expect(rep).toContain("## 선별 단계에서 제외 (1)");
      expect(rep).toContain("- D:/강의/1주차.pdf");
    } finally { await rm(d, { recursive: true, force: true }); }
  });
});
