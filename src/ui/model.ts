import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ReviewState } from "../core/schema.js";
import { parseCard } from "../store/frontmatter.js";
import type { LoadedExperience } from "../store/experiences.js";
import { inferCategory, toItem, type MasterItem } from "../store/masterMd.js";

export type UiExperience = MasterItem & {
  review: ReviewState; value: string | null;
  questions: { id: string; field: string; q: string; a: string | null }[];
  pending_apply: boolean; edited: boolean; keywords: string[]; outcome_keywords: string[];
  /** 편집 폼용 원래 값(표시 보정 전). role은 팀 규모 접미사 없이, metrics는 문서 통계 포함, category는 추정 전(null 가능) */
  raw: { period: string | null; role: string | null; team_size: number | null; category: string | null; metrics: string[] };
};

/** 모든 검토 상태의 경험을 UI용으로 변환한다(표시 보정은 master와 같은 toItem) */
export function buildUiState(exps: LoadedExperience[], fileTitles: Map<string, string | null>): UiExperience[] {
  return exps.map((e) => {
    const c = inferCategory(e.fm, e.fm.evidence.map((p) => fileTitles.get(p) ?? "").join(" "));
    return {
      ...toItem(e, c, fileTitles),
      review: e.fm.review, value: e.fm.value,
      questions: e.fm.questions.map((q) => ({ id: q.id, field: q.field, q: q.q, a: q.a })),
      pending_apply: e.fm.pending_apply, edited: e.edited,
      keywords: e.fm.keywords, outcome_keywords: e.fm.outcome_keywords,
      raw: { period: e.fm.period, role: e.fm.role, team_size: e.fm.team_size, category: e.fm.category, metrics: e.fm.metrics },
    };
  });
}

export async function loadFileTitles(out: string, exps: LoadedExperience[]): Promise<Map<string, string | null>> {
  const titles = new Map<string, string | null>();
  for (const p of new Set(exps.flatMap((e) => e.fm.evidence))) {
    try { const t = parseCard(await readFile(join(out, p), "utf8")).fm.title; titles.set(p, typeof t === "string" ? t : p); }
    catch { titles.set(p, null); }
  }
  return titles;
}

/** master.html(정적 모드)용: 채택만. 질의응답 원문·내부 판정값(가치·반영 대기·편집 표시)은 빼고 넣는다 */
export const adoptedOnly = (xs: UiExperience[]): UiExperience[] =>
  xs.filter((x) => x.review === "adopted").map((x) => ({ ...x, questions: [], value: null, pending_apply: false, edited: false }));
