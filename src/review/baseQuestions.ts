import type { ExperienceFrontmatter, State } from "../core/schema.js";

export const CONTRIBUTION_Q = "이 작업에서 본인이 직접 한 부분과 강의·팀원·AI의 도움을 받은 부분은 각각 무엇인가요? 지금 혼자 다시 할 수 있나요?";

/** evidence 카드들의 근거 파일 수정 연월(YYYY-MM)을 정렬·중복 제거해 돌려준다 */
export function evidenceModified(state: State, evidence: string[]): string[] {
  const out = new Set<string>();
  for (const rel of evidence) {
    for (const e of Object.values(state.files)) {
      if (e.card !== rel) continue;
      const m = (e.card_snapshot as { modified?: unknown } | null | undefined)?.modified;
      if (typeof m === "string" && m.length >= 7) out.add(m.slice(0, 7));
    }
  }
  return [...out].sort();
}

/** 질문 id는 기존 최대 번호 다음부터(삭제·재번호로 생긴 빈 번호와 겹치지 않게) */
export const nextQid = (qs: { id: string }[]) => Math.max(0, ...qs.map((q) => Number(q.id.match(/^q(\d+)$/)?.[1] ?? 0))) + 1;

const years = (s: string) => new Set(s.match(/\d{4}/g) ?? []);

/** 로컬에서 덧붙이는 기본 질문(11.4). 덧붙일 것이 없으면 같은 객체를 돌려준다 */
export function ensureBaseQuestions(fm: ExperienceFrontmatter, mods: string[]): ExperienceFrontmatter {
  const add: { field: ExperienceFrontmatter["questions"][number]["field"]; q: string }[] = [];
  if (fm.contribution === null && !fm.questions.some((q) => q.field === "contribution")) {
    add.push({ field: "contribution", q: CONTRIBUTION_Q });
  }
  if (!fm.questions.some((q) => q.field === "period")) {
    const range = mods.length ? (mods[0] === mods.at(-1) ? mods[0] : `${mods[0]} ~ ${mods.at(-1)}`) : null;
    if (fm.period === null) {
      add.push({ field: "period", q: `실제로 진행한 시기(시작~종료 연월)는 언제인가요?${range ? ` (근거 파일 수정일: ${range}, 복사·재저장 날짜일 수 있음)` : ""}` });
    } else if (range) {
      const py = years(fm.period);
      if (py.size > 0 && ![...years(mods.join(" "))].some((y) => py.has(y))) {
        add.push({ field: "period", q: `카드 기간은 ${fm.period}, 근거 파일 수정일은 ${range}입니다. 실제 진행 시기를 알려 주세요(맞으면 "맞음").` });
      }
    }
  }
  if (!add.length) return fm;
  const n = nextQid(fm.questions);
  return { ...fm, questions: [...fm.questions, ...add.map((x, i) => ({ id: `q${n + i}`, field: x.field, q: x.q, a: null }))] };
}
