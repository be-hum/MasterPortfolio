import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { REVIEW_STATES, type ReviewState, type State } from "../core/schema.js";
import { listExperiences, saveExperience, type LoadedExperience } from "../store/experiences.js";
import { decideReview, recordAnswer } from "./session.js";

const DECISION_WORDS: Record<string, ReviewState> = { 채택: "adopted", 보류: "held", 제외: "excluded" };
export const REVIEW_FILE = "review.md";

const ev = (e: LoadedExperience) => e.fm.evidence.map((p) => p.replace(/^files\//, "")).join(", ");

export async function writeReviewFile(out: string, decisions: LoadedExperience[], questions: LoadedExperience[]): Promise<string> {
  const lines = ["# MasterPortfolio 질의응답", "",
    "결정 절의 `결정:` 뒤에 채택·보류·제외 중 하나를 쓰세요. 질문 절의 `A:` 뒤에 답을 쓰세요(여러 줄 가능). 다 쓴 뒤 `mp review --apply`.", ""];
  if (decisions.length) {
    lines.push("# 1. 결정", "");
    for (const e of decisions) {
      lines.push(`## ${e.rel}`, `제목: ${e.fm.title}`,
        `기간: ${e.fm.period ?? "(미상)"} / 근거 ${e.fm.evidence.length}개 / 가치 ${e.fm.value ?? "미판정"}`, "", "결정:", "");
    }
  }
  if (questions.length) {
    lines.push("# 2. 질문", "");
    for (const e of questions) {
      lines.push(`## ${e.rel}`, `제목: ${e.fm.title}`, `기간: ${e.fm.period ?? "(미상)"} / 역할: ${e.fm.role ?? "(미상)"}`, `근거: ${ev(e)}`, "");
      for (const q of e.fm.questions.filter((x) => x.a === null)) lines.push(`### ${q.id} (${q.field}) ${q.q.replace(/\r?\n/g, " ")}`, "A:", "");
    }
  }
  const path = join(out, REVIEW_FILE);
  await writeFile(path, lines.join("\n"));
  return path;
}

export function parseReviewFile(text: string) {
  const sections: { rel: string; answers: Record<string, string>; decision: ReviewState | null }[] = [];
  const problems: string[] = [];
  let cur: (typeof sections)[number] | null = null; let qid: string | null = null; let buf: string[] = [];
  const flush = () => { if (cur && qid) { const v = buf.join(" ").trim(); if (v) cur.answers[qid] = v; } qid = null; buf = []; };
  for (const line of text.split(/\r?\n/)) {
    if (/^# /.test(line)) { flush(); cur = null; continue; }
    const h2 = line.match(/^## (experiences\/\S+\.md)\s*$/);
    const h3 = line.match(/^### (q\d+)\b/);
    const dec = line.match(/^결정:\s*(.*)$/);
    if (h2) {
      flush();
      cur = sections.find((x) => x.rel === h2[1]) ?? null;
      if (!cur) { cur = { rel: h2[1], answers: {}, decision: null }; sections.push(cur); }
      continue;
    }
    if (!cur) continue;
    if (h3) { flush(); qid = h3[1]; continue; }
    if (dec) {
      flush();
      const w = dec[1].trim();
      if (w) { const d = DECISION_WORDS[w]; if (d) cur.decision = d; else problems.push(`${cur.rel}: 알 수 없는 결정 "${w}"`); }
      continue;
    }
    if (qid) buf.push(line.replace(/^A:\s?/, ""));
  }
  flush();
  return { sections, problems };
}

export async function applyReviewFile(out: string, state: State, text: string): Promise<{ applied: string[]; problems: string[]; newlyAdoptedWithQuestions: number }> {
  const { sections, problems } = parseReviewFile(text);
  const exps = new Map((await listExperiences(out, state)).map((e) => [e.rel, e]));
  const applied: string[] = [];
  let newlyAdoptedWithQuestions = 0;
  for (const s of sections) {
    const e = exps.get(s.rel);
    if (!e) { problems.push(`${s.rel}: 경험 카드를 찾을 수 없음`); continue; }
    if (e.edited) { problems.push(`${s.rel}: 바깥에서 편집된 카드라 건너뜀`); continue; }
    let fm = e.fm;
    for (const [qid, a] of Object.entries(s.answers)) {
      const q = fm.questions.find((x) => x.id === qid);
      if (!q) { problems.push(`${s.rel}: 없는 질문 ${qid}`); continue; }
      if (q.a !== null) continue;
      fm = recordAnswer(fm, qid, a);
    }
    if (s.decision) {
      if (s.decision === "adopted" && e.fm.review !== "adopted" && fm.questions.some((q) => q.a === null)) newlyAdoptedWithQuestions++;
      fm = decideReview(fm, s.decision);
    }
    if (fm === e.fm) continue;
    if ("ok" in (await saveExperience(out, state, e, fm))) applied.push(s.rel);
    else problems.push(`${s.rel}: 저장 실패(편집 감지)`);
  }
  return { applied, problems, newlyAdoptedWithQuestions };
}

export const isReviewState = (v: string): v is ReviewState => (REVIEW_STATES as readonly string[]).includes(v);
export const readReviewFile = (out: string) => readFile(join(out, REVIEW_FILE), "utf8");
