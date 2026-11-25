import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { writeFileAtomic } from "../core/atomicWrite.js";
import { join } from "node:path";
import { ExperienceFrontmatter, type ExperienceQuestion, type State } from "../core/schema.js";
import { sha256String } from "../core/hash.js";
import { parseCard, stringifyCard } from "./frontmatter.js";
import { slugify } from "./slug.js";
import { saveState } from "./state.js";

export type Star = { s: string; t: string; a: string; r: string };
export type LoadedExperience = { rel: string; fm: ExperienceFrontmatter; body: string; star: Star | null; edited: boolean };

const STAR_EMPTY = "(질의응답 반영 후 작성)";
const one = (s: string) => s.replace(/\r?\n|\r/g, " ").trim();

export function renderExperienceBody(star: Star | null, questions: ExperienceQuestion[]): string {
  const starLines = star
    ? [`- Situation: ${one(star.s)}`, `- Task: ${one(star.t)}`, `- Action: ${one(star.a)}`, `- Result: ${one(star.r)}`]
    : [STAR_EMPTY];
  const qa = questions.filter((q) => q.a !== null).map((q) => `- Q: ${one(q.q)}\n  A: ${one(q.a!)}`);
  return `## STAR 요약\n${starLines.join("\n")}\n\n## 질의응답\n${qa.join("\n")}\n`;
}

export function parseStar(body: string): Star | null {
  const get = (k: string) => body.match(new RegExp(`^- ${k}: (.*)$`, "m"))?.[1]?.trim();
  const s = get("Situation"), t = get("Task"), a = get("Action"), r = get("Result");
  return s !== undefined && t !== undefined && a !== undefined && r !== undefined ? { s, t, a, r } : null;
}

const fileName = (title: string, content: string) => `${slugify(title)}-${sha256String(content).replace(/^sha256:/, "").slice(0, 6)}.md`;

export async function createExperience(out: string, state: State, fm: ExperienceFrontmatter): Promise<string> {
  const parsed = ExperienceFrontmatter.parse(fm);
  const content = stringifyCard(parsed, renderExperienceBody(null, parsed.questions));
  await mkdir(join(out, "experiences"), { recursive: true });
  const first = fileName(parsed.title, content + parsed.generated_at + Math.random());
  let name = first, n = 2;
  for (;;) {
    try { await writeFile(join(out, "experiences", name), content, { flag: "wx" }); break; }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      name = first.replace(/\.md$/, `-${n++}.md`);
    }
  }
  const rel = `experiences/${name}`;
  state.experiences[rel] = { card_body_hash: sha256String(content), card_snapshot: parsed as unknown as Record<string, unknown> };
  await saveState(out, state); // 카드 파일과 state 해시가 어긋나지 않게(중단돼도 편집으로 오인되지 않음)
  return rel;
}

export async function listExperiences(out: string, state: State): Promise<LoadedExperience[]> {
  let names: string[] = [];
  try { names = (await readdir(join(out, "experiences"))).filter((n) => n.endsWith(".md")).sort(); } catch { return []; }
  const res: LoadedExperience[] = [];
  for (const n of names) {
    const rel = `experiences/${n}`;
    let text: string;
    try { text = await readFile(join(out, rel), "utf8"); } catch { continue; }
    let parsedCard: { fm: Record<string, unknown>; body: string };
    try { parsedCard = parseCard(text); } catch { continue; }
    const p = ExperienceFrontmatter.safeParse(parsedCard.fm);
    if (!p.success) continue;
    const known = state.experiences[rel];
    res.push({ rel, fm: p.data, body: parsedCard.body, star: parseStar(parsedCard.body), edited: !known || known.card_body_hash !== sha256String(text) });
  }
  return res;
}

export async function saveExperience(
  out: string, state: State, e: LoadedExperience, fm: ExperienceFrontmatter, star: Star | null = e.star,
): Promise<{ ok: true } | { skipped: "edited" }> {
  const path = join(out, e.rel);
  const known = state.experiences[e.rel];
  let current: string;
  try { current = await readFile(path, "utf8"); } catch { return { skipped: "edited" }; }
  if (!known || known.card_body_hash !== sha256String(current)) return { skipped: "edited" };
  const parsed = ExperienceFrontmatter.parse(fm);
  const content = stringifyCard(parsed, renderExperienceBody(star, parsed.questions));
  await writeFileAtomic(path, content);
  state.experiences[e.rel] = { card_body_hash: sha256String(content), card_snapshot: parsed as unknown as Record<string, unknown> };
  await saveState(out, state);
  e.fm = parsed; e.star = star; e.body = renderExperienceBody(star, parsed.questions);
  return { ok: true };
}

/** 사용자가 고친 경험 카드를 현재 내용 그대로 다시 기록한다(listExperiences가 ExperienceFrontmatter로 읽은 카드만 넘어옴). */
export async function acceptExperienceEdit(out: string, state: State, e: LoadedExperience): Promise<void> {
  const text = await readFile(join(out, e.rel), "utf8");
  state.experiences[e.rel] = { card_body_hash: sha256String(text), card_snapshot: e.fm as unknown as Record<string, unknown> };
  await saveState(out, state);
}
