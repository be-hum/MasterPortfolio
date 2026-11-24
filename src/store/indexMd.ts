import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DOC_TYPES } from "../core/schema.js";
import { parseCard } from "./frontmatter.js";

const RANK: Record<string, number> = { 상: 0, 중: 1, 하: 2 };
export const cell = (s: unknown) => String(s ?? "").replace(/\r?\n/g, " ").replace(/[\\[\]<>|]/g, (c) => `\\${c}`);

type Card = { n: string; fm: Record<string, unknown> };
/** value 내림차순, 미판정(null)은 맨 아래 (10.6, 9.6) */
const byValue = (a: Card, b: Card) => (RANK[a.fm.value as string] ?? 9) - (RANK[b.fm.value as string] ?? 9);

function table(title: string, group: Card[]): string[] {
  const lines = [`## ${title}`, "", "| 가치 | 제목 | 기간 | 기술 | 이력서 반영 |", "|---|---|---|---|---|"];
  for (const c of group) {
    const skills = Array.isArray(c.fm.skills) ? (c.fm.skills as string[]).join(", ") : "";
    lines.push(`| ${c.fm.value == null ? "미판정" : cell(c.fm.value)} | [${cell(c.fm.title ?? c.n)}](files/${encodeURI(c.n)}) | ${cell(c.fm.period)} | ${cell(skills)} | ${cell(c.fm.in_resume)} |`);
  }
  lines.push("");
  return lines;
}

export async function writeIndex(outputDir: string): Promise<void> {
  let names: string[] = [];
  try { names = (await readdir(join(outputDir, "files"))).filter((n) => n.endsWith(".md")); } catch { /* 없음 */ }
  const cards: Card[] = [];
  const broken: string[] = [];
  await Promise.all(names.map(async (n) => {
    try { cards.push({ n, fm: parseCard(await readFile(join(outputDir, "files", n), "utf8")).fm }); }
    catch { broken.push(n); }
  }));
  cards.sort((a, b) => a.n.localeCompare(b.n));
  broken.sort();
  const lines = ["# MasterPortfolio 인벤토리", "", `파일 카드 ${cards.length + broken.length}개`, ""];
  for (const t of DOC_TYPES) {
    const group = cards.filter((c) => c.fm.type === t).sort(byValue);
    if (group.length) lines.push(...table(t, group));
  }
  const known = new Set<unknown>(DOC_TYPES);
  const other = cards.filter((c) => !known.has(c.fm.type)).sort(byValue);
  if (other.length) lines.push(...table("기타(분류 불명)", other));
  if (broken.length) {
    lines.push("## 읽을 수 없는 카드", "");
    for (const n of broken) lines.push(`- [${cell(n)}](files/${encodeURI(n)})`);
    lines.push("");
  }
  await writeFile(join(outputDir, "index.md"), lines.join("\n"));
}
