import type { ExperienceFrontmatter, ReviewState, State } from "../core/schema.js";
import { sanitize } from "../privacy/mask.js";
import { saveExperience, type LoadedExperience } from "../store/experiences.js";
import { isoNow } from "../store/cards.js";

export type ReviewIO = {
  show(text: string): void;
  /** null = 그만두기, "" = 건너뛰기 */
  answer(q: string): Promise<string | null>;
  /** null = 그만두기(아무것도 바꾸지 않음). 반환 rel 집합. 고르지 않은 나머지는 보류 */
  decideMany(items: { rel: string; label: string }[]): Promise<{ adopted: Set<string>; excluded: Set<string> } | null>;
};

export function decisionTargets(exps: LoadedExperience[], all: boolean): LoadedExperience[] {
  return exps.filter((e) => !e.edited && (e.fm.review === "pending" || e.fm.review === "held") && (all || e.fm.value !== "하"));
}

export function questionTargets(exps: LoadedExperience[]): LoadedExperience[] {
  return exps.filter((e) => !e.edited && e.fm.review === "adopted" && e.fm.questions.some((q) => q.a === null));
}

export function recordAnswer(fm: ExperienceFrontmatter, qid: string, raw: string): ExperienceFrontmatter {
  const v = raw.replace(/\s+/g, " ").trim();
  if (!v) return fm;
  // pending_apply = 아직 반영되지 않은 답이 있음(반영 단계가 지움)
  return { ...fm, pending_apply: true, questions: fm.questions.map((q) => (q.id === qid ? { ...q, a: sanitize(v).text } : q)) };
}

export function decideReview(fm: ExperienceFrontmatter, decision: ReviewState): ExperienceFrontmatter {
  return { ...fm, review: decision, reviewed_at: isoNow() };
}

const summary = (e: LoadedExperience) => [
  `\n■ ${e.fm.title}`,
  `  기간: ${e.fm.period ?? "(미상)"} / 소속: ${e.fm.org ?? "(미상)"} / 역할: ${e.fm.role ?? "(미상)"} / 가치: ${e.fm.value ?? "미판정"}`,
  `  근거: ${e.fm.evidence.map((p) => p.replace(/^files\//, "")).join(", ")}`,
].join("\n");

export async function runReviewSession(out: string, state: State, exps: LoadedExperience[], all: boolean, io: ReviewIO) {
  let answered = 0, decided = 0;
  const dts = decisionTargets(exps, all);
  if (dts.length) {
    const items = dts.map((e, i) => ({
      rel: e.rel,
      label: `${i + 1}. ${e.fm.title} — ${e.fm.period ?? "기간 미상"} · 근거 ${e.fm.evidence.length}개 · 가치 ${e.fm.value ?? "미판정"}`,
    }));
    const r = await io.decideMany(items);
    if (r === null) return { answered, decided, quit: true };
    for (const e of dts) {
      const d: ReviewState = r.adopted.has(e.rel) ? "adopted" : r.excluded.has(e.rel) ? "excluded" : "held";
      if ("ok" in (await saveExperience(out, state, e, decideReview(e.fm, d)))) decided++;
    }
  }
  for (const e of questionTargets(exps)) {
    io.show(summary(e));
    for (const q of e.fm.questions.filter((x) => x.a === null)) {
      const raw = await io.answer(q.q);
      if (raw === null) return { answered, decided, quit: true };
      const next = recordAnswer(e.fm, q.id, raw);
      if (next === e.fm) continue;
      if ("skipped" in (await saveExperience(out, state, e, next))) { io.show("  카드가 바깥에서 편집되어 저장하지 않았습니다."); break; }
      answered++;
    }
  }
  return { answered, decided, quit: false };
}
