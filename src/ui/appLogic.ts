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

/* ---------- 처음 설정·설정 화면 (11.6) ---------- */
var PLANS = [[1, "Pro"], [5, "Max 5x"], [20, "Max 20x"]];
/** 폴더 제안 묶음: 직접 추가가 맨 위, 다음 기본·클라우드·드라이브·이름이 맞는 폴더 */
var FOLDER_GROUPS = [
  ["manual", "직접 추가한 폴더", ["manual"]],
  ["base", "기본 폴더", ["documents", "downloads", "desktop"]],
  ["cloud", "클라우드 폴더", ["cloud"]],
  ["drive", "다른 드라이브", ["drive"]],
  ["wsl", "WSL(리눅스) 폴더", ["wsl"]],
  ["keyword", "이름이 맞는 폴더", ["keyword"]]
];
/** 메인 화면에서 "새 폴더"로 알리는 제안 종류 */
var HINT_KINDS = ["cloud", "drive", "wsl"];
/** 경로 비교 키: 끝 구분자 제거, Windows 경로(드라이브 문자·역슬래시)는 대소문자 무시 */
function folderKey(p) {
  var s = String(p || "").trim().replace(/[\\/]+$/, "").replace(/^\\\\wsl\$\\/i, "\\\\wsl.localhost\\");
  return /^[A-Za-z]:|\\/.test(s) ? s.replace(/\//g, "\\").toLowerCase() : s;
}
/** 목록에 폴더 추가: 맨 위에 체크된 상태로(이미 있으면 맨 위로 옮겨 체크). 빈 경로면 그대로 */
function addFolderTo(list, path) {
  var p = String(path || "").trim();
  if (!p) return list.slice();
  var k = folderKey(p), old = null;
  var rest = list.filter(function (f) { if (folderKey(f.path) === k) { old = f; return false; } return true; });
  var item = old ? { path: old.path, label: old.label, kind: old.kind, checked: true } : { path: p, label: p, kind: "manual", checked: true };
  return [item].concat(rest);
}
/** 새 제안을 기존 목록에 합친다: 기존 항목(직접 추가·체크 상태)은 그대로, 새 경로만 제안 순서대로 뒤에 */
function mergeFolders(list, sugg) {
  var have = {};
  list.forEach(function (f) { have[folderKey(f.path)] = 1; });
  var add = (sugg || []).filter(function (f) { var k = folderKey(f.path); if (have[k]) return false; have[k] = 1; return true; })
    .map(function (f) { return { path: f.path, label: f.label, kind: f.kind, checked: !!f.checked }; });
  return list.concat(add);
}
/** 종류별 묶음(빈 묶음은 뺀다). 알 수 없는 종류는 직접 추가로 */
function groupFolders(list) {
  return FOLDER_GROUPS.map(function (g) {
    return { key: g[0], label: g[1], items: list.filter(function (f) {
      var kind = FOLDER_GROUPS.some(function (x) { return x[2].indexOf(f.kind) >= 0; }) ? f.kind : "manual";
      return g[2].indexOf(kind) >= 0;
    }) };
  }).filter(function (g) { return g.items.length; });
}
/** 아직 목록에 없는 제안만 */
function newSuggestions(sugg, paths) {
  var have = {};
  (paths || []).forEach(function (p) { have[folderKey(p)] = 1; });
  return (sugg || []).filter(function (f) { return !have[folderKey(f.path)]; });
}
/** 마법사 단계 검사: 문제 문구 목록(빈 배열 = 다음으로 갈 수 있음). 1단계는 건너뛸 수 있어 늘 통과 */
function wizardErrors(step, w) {
  var e = [];
  if (step === 2 && !w.folders.some(function (f) { return f.checked; })) e.push("스캔할 폴더를 하나 이상 고르세요");
  if (step === 3) {
    if (!String(w.output || "").trim()) e.push("결과 폴더를 입력하세요");
    if ([1, 5, 20].indexOf(w.planScale) < 0) e.push("요금제를 고르세요");
  }
  return e;
}
/** 처음 설정 저장 본문 */
function setupPayload(w) {
  return {
    university: String(w.university || "").trim(),
    keywords: w.keywords.filter(function (k) { return k.checked; }).map(function (k) { return k.text; }),
    folders: w.folders.filter(function (f) { return f.checked; }).map(function (f) { return f.path; }),
    planScale: w.planScale, output: String(w.output || "").trim(),
    // 체크를 끈 WSL 제안은 메인 화면에서 다시 묻지 않는다
    // 체크를 끈 클라우드·드라이브·WSL 제안은 메인 화면에서 다시 묻지 않는다
    dismissed: w.folders.filter(function (f) { return HINT_KINDS.indexOf(f.kind) >= 0 && !f.checked; }).map(function (f) { return f.path; })
  };
}
/**
 * 포트폴리오 완성도(11.7): 채택한 경험마다 기간·수행 방식·STAR 요약·경험 키워드 4항목을 채운 비율의 평균(0~100 정수).
 * missing: 항목별로 비어 있는 채택 경험 수
 */
function completeness(exps) {
  var ad = exps.filter(function (e) { return e.review === "adopted"; });
  var missing = { period: 0, contribution: 0, star: 0, keywords: 0 };
  if (!ad.length) return { pct: 0, adopted: 0, missing: missing };
  var filled = 0;
  ad.forEach(function (e) {
    var have = { period: !!e.period, contribution: !!e.contribution, star: !!(e.star && (e.star.s || e.star.t || e.star.a || e.star.r)), keywords: !!(e.keywords && e.keywords.length) };
    Object.keys(have).forEach(function (k) { if (have[k]) filled++; else missing[k]++; });
  });
  return { pct: Math.round(filled / (ad.length * 4) * 100), adopted: ad.length, missing: missing };
}
/** 주소의 해시 → 화면: #/ 홈, #/exp 경험, #/master 마스터, #/help 도움말. 그 밖(목차 앵커 #프로젝트 등)은 경험 */
function routeOf(hash) {
  var h = String(hash || "");
  if (h === "" || h === "#" || h === "#/") return "home";
  var m = /^#\/(exp|master|help)\b/.exec(h);
  return m ? m[1] : "exp";
}
/** 예산 비율 % 입력 → 0.05~1 (숫자가 아니면 null) */
function pctToShare(v) {
  var n = Number(String(v).trim());
  if (String(v).trim() === "" || !isFinite(n)) return null;
  return Math.round(Math.min(100, Math.max(5, n))) / 100;
}
/** 설정 저장 본문: 바뀐 필드만(scanFolders는 보낼 때마다 존재를 다시 검사하므로 그대로면 빼기) */
function settingsDiff(cur, base) {
  var out = {};
  if (JSON.stringify(cur.scanFolders) !== JSON.stringify(base.scanFolders)) out.scanFolders = cur.scanFolders.slice();
  if (cur.planScale !== base.planScale) out.planScale = cur.planScale;
  if (cur.fiveHourShare !== base.fiveHourShare) out.fiveHourShare = cur.fiveHourShare;
  var k = splitList(cur.keywords), k0 = splitList(base.keywords);
  if (JSON.stringify(k) !== JSON.stringify(k0)) out.keywords = k;
  return out;
}
/** 폴더 범위 판단 표 검색: 경로·포함/제외·판단 주체에서 찾고 경로순 */
var SCOPE_LABEL = { include: "포함", exclude: "제외", llm: "LLM", user: "사용자" };
function filterScope(rows, q) {
  var words = String(q || "").toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter(function (r) {
    var h = [r.path, SCOPE_LABEL[r.decision] || r.decision, SCOPE_LABEL[r.by] || r.by, r.at].join(" ").toLowerCase();
    return words.every(function (w) { return h.indexOf(w) >= 0; });
  }).sort(function (a, b) { return a.path < b.path ? -1 : a.path > b.path ? 1 : 0; });
}
/** 점검 항목 표시: ok ✔, warn !, 그 밖은 ✘ */
function checkMark(it) { return it.ok ? "ok" : it.warn ? "warn" : "fail"; }
`;

export type Filter = { statuses: string[] | null; contribs: string[]; category: string | null; q: string; todo: "decide" | "answer" | "apply" | null };
export type Group = { key: string; label: string; items: UiExperience[] };
export interface AppLogic {
  completeness(exps: Partial<UiExperience>[]): { pct: number; adopted: number; missing: { period: number; contribution: number; star: number; keywords: number } };
  routeOf(hash: string): "home" | "exp" | "master" | "help";
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
  folderKey(p: string): string;
  addFolderTo(list: WizFolder[], path: string): WizFolder[];
  mergeFolders(list: WizFolder[], sugg: WizFolder[]): WizFolder[];
  groupFolders(list: WizFolder[]): { key: string; label: string; items: WizFolder[] }[];
  newSuggestions(sugg: WizFolder[], paths: string[]): WizFolder[];
  wizardErrors(step: number, w: { folders: WizFolder[]; output: string; planScale: number }): string[];
  setupPayload(w: { university: string; keywords: { text: string; checked: boolean }[]; folders: WizFolder[]; planScale: number; output: string }): { university: string; keywords: string[]; folders: string[]; planScale: number; output: string };
  pctToShare(v: string | number): number | null;
  settingsDiff(cur: SettingsForm, base: SettingsForm): Partial<{ scanFolders: string[]; planScale: number; fiveHourShare: number; keywords: string[] }>;
  filterScope(rows: ScopeRow[], q: string): ScopeRow[];
  checkMark(it: { ok: boolean; warn?: boolean }): "ok" | "warn" | "fail";
}
export type WizFolder = { path: string; label: string; kind: string; checked: boolean };
export type SettingsForm = { scanFolders: string[]; planScale: number; fiveHourShare: number; keywords: string };
export type ScopeRow = { path: string; decision: string; by: string; at: string };
const EXPORTS = ["endOf", "yearOf", "inTodo", "todoCounts", "matchText", "filterList", "groupList", "countBy", "chipsOf", "outMark", "oneLine", "starText", "splitList",
  "folderKey", "addFolderTo", "mergeFolders", "groupFolders", "newSuggestions", "wizardErrors", "setupPayload", "pctToShare", "settingsDiff", "filterScope", "checkMark", "completeness", "routeOf"];

/** 테스트용: 브라우저에 넣는 문자열을 그대로 평가한다 */
export function loadLogic(): AppLogic {
  return new Function(`${LOGIC_JS}\nreturn { ${EXPORTS.join(", ")} };`)() as AppLogic;
}
