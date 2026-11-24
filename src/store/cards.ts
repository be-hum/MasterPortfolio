import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Candidate } from "../scan/prefilter.js";
import { FileCardFrontmatter, type FileExtraction, type JudgeResult, type StateEntry } from "../core/schema.js";
import { normalizePath } from "../core/paths.js";
import { sha256String } from "../core/hash.js";
import { cardFileName } from "./slug.js";
import { parseCard, stringifyCard } from "./frontmatter.js";

export const isoNow = () => {
  const d = new Date(), off = -d.getTimezoneOffset(), sign = off >= 0 ? "+" : "-";
  const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, "0");
  return new Date(d.getTime() + off * 60000).toISOString().slice(0, 19) + `${sign}${pad(off / 60)}:${pad(off % 60)}`;
};

export const localDate = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** 1단계 결과로 카드를 쓴다. 가치 판정은 2단계에서 하므로 value/value_reason은 null(= 미판정, 9.6). */
export async function writeFileCard(outputDir: string, c: Candidate, a: FileExtraction, agent: string) {
  const fm = FileCardFrontmatter.parse({
    schema_version: 1, kind: "file", source: normalizePath(c.path), source_hash: c.hash, format: c.format,
    size: c.size, modified: localDate(c.mtimeMs), duplicates: c.duplicates,
    type: a.type, use_for: a.use_for, title: a.title, summary: a.summary, period: a.period, role: a.role,
    skills: a.skills, metrics: a.metrics, org: a.org, value: null, value_reason: null,
    in_resume: a.in_resume, agent, generated_at: isoNow(),
  });
  const body = `## 상세 요약\n${a.detail}\n\n## 근거 발췌\n${a.excerpts.map((e) => `- ${e}`).join("\n")}\n`;
  const content = stringifyCard(fm, body);
  await mkdir(join(outputDir, "files"), { recursive: true });
  const first = cardFileName(fm);
  let name = first, n = 2;
  for (;;) {
    try { await writeFile(join(outputDir, "files", name), content, { flag: "wx" }); break; }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      name = first.replace(/\.md$/, `-${n++}.md`);
    }
  }
  const relPath = `files/${name}`;
  const entry: StateEntry = {
    source_hash: c.hash, card: relPath, card_body_hash: sha256String(content),
    card_snapshot: fm as unknown as Record<string, unknown>, status: "done",
  };
  return { relPath, entry };
}

/**
 * 판정 결과를 카드에 반영한다(9.6). frontmatter의 value/value_reason만 바꾸고 본문은 그대로 둔다.
 * 사용자가 편집한 카드(현재 해시가 card_body_hash와 다름, 해시 없음, __protected)는 건드리지 않는다.
 */
export async function setCardJudgement(
  outputDir: string, relPath: string, r: Pick<JudgeResult, "value" | "value_reason">, entry: StateEntry,
): Promise<{ entry: StateEntry } | { skipped: "edited" }> {
  const path = join(outputDir, relPath);
  if (!entry.card_body_hash || (entry.card_snapshot as Record<string, unknown> | null)?.__protected) return { skipped: "edited" };
  const text = await readFile(path, "utf8");
  if (sha256String(text) !== entry.card_body_hash) return { skipped: "edited" };
  const { fm, body } = parseCard(text);
  const next = FileCardFrontmatter.parse({ ...fm, value: r.value, value_reason: r.value_reason });
  const content = stringifyCard(next, body);
  await writeFile(path, content);
  return { entry: { ...entry, card_body_hash: sha256String(content), card_snapshot: next as unknown as Record<string, unknown> } };
}
