import { CATEGORIES, type Category, type ExperienceFrontmatter } from "../core/schema.js";
import type { LoadedExperience, Star } from "./experiences.js";

const esc = (s: string) => s.replace(/\r?\n|\r/g, " ").replace(/[\\[\]<>]/g, (c) => `\\${c}`);
const endOf = (p: string | null) => (p?.match(/\d{4}-\d{2}/g) ?? []).at(-1) ?? "";

/** 문서 통계만으로 된 성과(쉼표로 나눈 조각이 모두 통계일 때만). "파일 1,000개 일괄 변환" 같은 성과는 남긴다 */
const DOC_STAT_PART = /^((슬라이드|페이지|쪽|파일|header ?file|source ?file|참고 ?자료)\s*[\d,]+\s*(장|쪽|페이지|개|건)?(\s*구성)?|[\d,]+\s*(쪽|페이지))$/i;
const isDocStat = (m: string) => m.split(/,\s*/).every((p) => DOC_STAT_PART.test(p.trim()));

/** extra: 근거 파일 카드 제목 등 추가 단서(대회·CTF 판정에만 쓴다) */
export function inferCategory(fm: ExperienceFrontmatter, extra = ""): Category {
  if (fm.category) return fm.category;
  const t = `${fm.title} ${fm.org ?? ""}`;
  if (/CTF|워게임|wargame|dreamhack|pwnable|대회|예선|본선|해커톤|공모전|write-?up/i.test(`${t} ${extra}`)) return "대회·CTF";
  if (/동아리|스터디|학회/.test(t)) return "동아리·스터디";
  if (/\bLab\b|연구실|연구/i.test(t)) return "연구";
  if (/수업|과제|강의|교육과정|학기/.test(t) || fm.type === "과제") return "교육·수업";
  return "프로젝트";
}

/** master.md·master.html이 함께 쓰는 표시용 모델(11.3, 11.4 표시 보정 적용) */
export type MasterItem = {
  rel: string; title: string; category: Category; period: string | null; org: string | null;
  /** 팀 규모 표시까지 붙인 역할 줄. 역할이 없으면 "팀 규모: …" 형태로 team에만 담는다 */
  role: string | null; team: string | null;
  contribution: string | null; skills: string[]; metrics: string[]; star: Star | null;
  evidence: { path: string; title: string | null }[];
};
export type MasterView = { groups: { category: Category; items: MasterItem[] }[]; total: number };

export function buildMasterView(exps: LoadedExperience[], fileTitles: Map<string, string | null>): MasterView {
  const adopted = exps.filter((e) => e.fm.review === "adopted");
  const cats = adopted.map((e) => ({ e, c: inferCategory(e.fm, e.fm.evidence.map((p) => fileTitles.get(p) ?? "").join(" ")) }));
  const groups: MasterView["groups"] = [];
  for (const c of CATEGORIES) {
    const g = cats.filter((x) => x.c === c).map((x) => x.e).sort((a, b) => {
      const ea = endOf(a.fm.period), eb = endOf(b.fm.period);
      if (ea !== eb) return !ea ? 1 : !eb ? -1 : eb.localeCompare(ea);
      return a.fm.title.localeCompare(b.fm.title);
    });
    if (!g.length) continue;
    groups.push({ category: c, items: g.map((e) => toItem(e, c, fileTitles)) });
  }
  return { groups, total: adopted.length };
}

export function toItem(e: LoadedExperience, category: Category, fileTitles: Map<string, string | null>): MasterItem {
  const f = e.fm;
  let role: string | null = null, team: string | null = null;
  if (f.role) {
    const suffix = f.team_size === 1 ? (/개인|단독|혼자/.test(f.role) ? "" : " (개인)") : f.team_size ? ` (팀 ${f.team_size}명)` : "";
    role = `${f.role}${suffix}`;
  } else if (f.team_size) team = f.team_size === 1 ? "개인" : `${f.team_size}명`;
  return {
    rel: e.rel, title: f.title, category,
    period: f.period ? f.period.replace(/^(\d{4}-\d{2}) ~ \1$/, "$1") : null,
    org: f.org, role, team, contribution: f.contribution, skills: f.skills,
    metrics: f.metrics.filter((m) => !isDocStat(m)), star: e.star,
    evidence: f.evidence.map((p) => ({ path: p, title: fileTitles.get(p) ?? null })),
  };
}

export function renderMaster(exps: LoadedExperience[], fileTitles: Map<string, string | null>): string {
  const view = buildMasterView(exps, fileTitles);
  const lines = ["# Master Record", "", "> 자동 생성 — 수정은 experiences/의 경험 카드에서 하세요. `mp master`를 다시 실행하면 이 파일 전체를 다시 씁니다.", ""];
  if (!view.total) return [...lines, "채택된 경험이 없습니다. `mp group`과 `mp review`를 먼저 실행하세요.", ""].join("\n");
  for (const { category, items } of view.groups) {
    lines.push(`## ${category}`, "");
    for (const i of items) {
      lines.push(`### ${esc(i.title)}`);
      if (i.period) lines.push(`- 기간: ${esc(i.period)}`);
      if (i.org) lines.push(`- 소속: ${esc(i.org)}`);
      if (i.role) lines.push(`- 역할: ${esc(i.role)}`);
      else if (i.team) lines.push(`- 팀 규모: ${i.team}`);
      if (i.contribution) lines.push(`- 수행 방식: ${i.contribution}`);
      if (i.skills.length) lines.push(`- 기술: ${i.skills.map(esc).join(", ")}`);
      if (i.metrics.length) lines.push(`- 성과: ${i.metrics.map(esc).join(", ")}`);
      if (i.star) lines.push("- STAR", `  - Situation: ${esc(i.star.s)}`, `  - Task: ${esc(i.star.t)}`, `  - Action: ${esc(i.star.a)}`, `  - Result: ${esc(i.star.r)}`);
      const ev = i.evidence.map(({ path, title }) =>
        title == null ? `~~${esc(path.replace(/^files\//, ""))} (카드 없음)~~` : `[${esc(title)}](${encodeURI(path)})`);
      if (ev.length) lines.push(`- 근거: ${ev.join(", ")}`);
      lines.push("");
    }
  }
  return lines.join("\n");
}
