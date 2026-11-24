import { CATEGORIES, CONTRIBUTIONS } from "../core/schema.js";
import type { UiExperience } from "./model.js";

/**
 * 화면 스크립트의 순수 로직(필터·정렬·카운트·그룹).
 * 브라우저에는 이 문자열을 그대로 넣고, 테스트는 같은 문자열을 loadLogic()으로 평가해 검사한다(사본 없이 한 벌).
 * 빌드 도구 없이 인라인해야 하므로 TS가 아닌 평범한 JS로 쓴다(템플릿 리터럴·백틱 금지).
 */
export const LOGIC_JS = `var CATEGORIES = ${JSON.stringify(CATEGORIES)};
var CONTRIBUTIONS = ${JSON.stringify(CONTRIBUTIONS)};
` + String.raw`var NO_CONTRIB = "미정";
var NO_PERIOD = "기간 없음";
var REVIEW_LABEL = { adopted: "채택", held: "보류", excluded: "제외", pending: "대기" };

/** 기간 끝 연월(YYYY-MM). 연월이 없고 연도만 있으면 YYYY, 없으면 "" */
function endOf(p) {
  var s = p || "";
  var m = s.match(/\d{4}-\d{2}/g);
  if (m) return m[m.length - 1];
  var y = s.match(/\d{4}/g);
  return y ? y[y.length - 1] : "";
}
function yearOf(p) { return endOf(p).slice(0, 4); }

/** 최신순(기간 끝), 기간 없음은 뒤, 같으면 제목순 */
function cmpItems(a, b) {
  var ea = endOf(a.period), eb = endOf(b.period);
  if (ea !== eb) return !ea ? 1 : !eb ? -1 : (eb < ea ? -1 : 1);
  return a.title.localeCompare(b.title, "ko");
}

function unanswered(e) { return e.questions.filter(function (q) { return q.a === null; }); }

/** 할 일: decide 결정 대기(검토 전), answer 채택했는데 미응답 질문, apply 반영 대기(채택·보류) */
function inTodo(e, k) {
  if (k === "decide") return e.review === "pending";
  if (k === "answer") return e.review === "adopted" && unanswered(e).length > 0;
  if (k === "apply") return !!e.pending_apply && (e.review === "adopted" || e.review === "held");
  return true;
}
function todoCounts(list) {
  var c = { decide: 0, answer: 0, apply: 0 };
  list.forEach(function (e) { ["decide", "answer", "apply"].forEach(function (k) { if (inTodo(e, k)) c[k]++; }); });
  return c;
}

function haystack(e) {
  return [e.title, e.org, e.role, e.team, e.period, e.category, e.contribution]
    .concat(e.keywords, e.outcome_keywords, e.skills, e.metrics)
    .filter(Boolean).join(" ").toLowerCase();
}
function matchText(e, q) {
  var words = (q || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  var h = haystack(e);
  return words.every(function (w) { return h.indexOf(w) >= 0; });
}

/**
 * f: { statuses: string[] | null, contribs: string[] (빈 배열 = 전체, 수행 방식 없음은 "미정"),
 *      category: string | null, q: string, todo: "decide" | "answer" | "apply" | null }
 * todo가 있으면 상태 필터 대신 할 일 조건을 쓴다.
 */
function filterList(list, f) {
  return list.filter(function (e) {
    if (f.todo) { if (!inTodo(e, f.todo)) return false; }
    else if (f.statuses && f.statuses.indexOf(e.review) < 0) return false;
    if (f.contribs && f.contribs.length && f.contribs.indexOf(e.contribution || NO_CONTRIB) < 0) return false;
    if (f.category && e.category !== f.category) return false;
    return matchText(e, f.q);
  });
}

/** view "category": CATEGORIES 순서, "year": 최신 연도부터, 기간 없음은 마지막. 빈 그룹은 뺀다 */
function groupList(list, view) {
  var sorted = list.slice().sort(cmpItems);
  if (view === "year") {
    var years = [];
    sorted.forEach(function (e) { var y = yearOf(e.period) || NO_PERIOD; if (years.indexOf(y) < 0) years.push(y); });
    years.sort(function (a, b) { return a === NO_PERIOD ? 1 : b === NO_PERIOD ? -1 : (a < b ? 1 : -1); });
    return years.map(function (y) {
      return { key: "y-" + (y === NO_PERIOD ? "none" : y), label: y === NO_PERIOD ? y : y + "년",
        items: sorted.filter(function (e) { return (yearOf(e.period) || NO_PERIOD) === y; }) };
    });
  }
  var cats = CATEGORIES.concat(sorted.map(function (e) { return e.category; }).filter(function (c) { return CATEGORIES.indexOf(c) < 0; }));
  var out = [];
  cats.forEach(function (c, i) {
    if (out.some(function (g) { return g.label === c; })) return;
    var items = sorted.filter(function (e) { return e.category === c; });
    if (items.length) out.push({ key: "c-" + i, label: c, items: items });
  });
  return out;
}

function countBy(list, fn) {
  var m = {};
  list.forEach(function (e) { var k = fn(e); m[k] = (m[k] || 0) + 1; });
  return m;
}

function clip(s, n) { return s.length > n ? s.slice(0, n - 1) + "…" : s; }
/** 목록 칩: 성과 키워드가 없으면 성과 첫 항목(24자)을 흐린 칩으로 */
function chipsOf(e) {
  return { kw: e.keywords.slice(), out: e.outcome_keywords.slice(),
    fallback: !e.outcome_keywords.length && e.metrics.length ? clip(e.metrics[0], 24) : null };
}
/** 성과 칩 접두: 수치가 있으면 ▲, 아니면 ✓ */
function outMark(s) { return /\d/.test(s) ? "▲" : "✓"; }

/** 이력서에 바로 붙일 한 줄: 제목 (기간) — 역할 · 성과 */
function oneLine(e) {
  var head = e.period ? e.title + " (" + e.period + ")" : e.title;
  var tail = [e.role || (e.team ? "팀 규모 " + e.team : null), e.metrics.length ? e.metrics.join(", ") : null].filter(Boolean).join(" · ");
  return tail ? head + " — " + tail : head;
}
function starText(e) {
  return e.star ? "Situation: " + e.star.s + "\nTask: " + e.star.t + "\nAction: " + e.star.a + "\nResult: " + e.star.r : "";
}
/** 쉼표 구분 입력 → 목록 */
function splitList(s, sep) {
  return (s || "").split(sep || ",").map(function (x) { return x.trim(); }).filter(Boolean);
}
`;

export type Filter = { statuses: string[] | null; contribs: string[]; category: string | null; q: string; todo: "decide" | "answer" | "apply" | null };
export type Group = { key: string; label: string; items: UiExperience[] };
export interface AppLogic {
  endOf(p: string | null): string;
  yearOf(p: string | null): string;
  inTodo(e: UiExperience, k: string): boolean;
  todoCounts(list: UiExperience[]): { decide: number; answer: number; apply: number };
  matchText(e: UiExperience, q: string): boolean;
  filterList(list: UiExperience[], f: Filter): UiExperience[];
  groupList(list: UiExperience[], view: "category" | "year"): Group[];
  countBy(list: UiExperience[], fn: (e: UiExperience) => string): Record<string, number>;
  chipsOf(e: UiExperience): { kw: string[]; out: string[]; fallback: string | null };
  outMark(s: string): string;
  oneLine(e: UiExperience): string;
  starText(e: UiExperience): string;
  splitList(s: string, sep?: string): string[];
}
const EXPORTS = ["endOf", "yearOf", "inTodo", "todoCounts", "matchText", "filterList", "groupList", "countBy", "chipsOf", "outMark", "oneLine", "starText", "splitList"];

/** 테스트용: 브라우저에 넣는 문자열을 그대로 평가한다 */
export function loadLogic(): AppLogic {
  return new Function(`${LOGIC_JS}\nreturn { ${EXPORTS.join(", ")} };`)() as AppLogic;
}
