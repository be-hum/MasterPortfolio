import { brandSanitized, type SanitizedText } from "./sanitized.js";

export type MaskKind = "rrn" | "card" | "account" | "passport" | "phone";
const MARKERS: Record<MaskKind, string> = {
  rrn: "[주민번호]", card: "[카드번호]", account: "[계좌번호]", passport: "[여권번호]", phone: "[전화번호]",
};

function validYYMMDD(s: string): boolean {
  const mm = Number(s.slice(2, 4)), dd = Number(s.slice(4, 6));
  return mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31;
}

function luhn(digits: string): boolean {
  let sum = 0, alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return sum % 10 === 0;
}

const RRN = /(?<!\d)(\d{6})[ \t]{0,3}[-\u2013\u2014]?[ \t]{0,3}([1-8]\d{6})(?!\d)/g;
const RRN_PARTIAL = /(?<!\d)(\d{6})[-\u2013\u2014]?[1-8]\*{6}/g;
const CARD = /(?<!\d)(?:\d[- ]?){12,18}\d(?!\d)/g;
const ACCOUNT_KW = /(계좌|은행|입금|예금주|account)/i;
const ACCOUNT = /(?<![\d-])\d{2,6}(?:-\d{2,7}){1,3}(?![\d-])/g;
const PASSPORT_KW = /(여권|passport)/i;
const PASSPORT = /(?<![A-Za-z0-9])(?:[A-Za-z]{1,2}\d{7,8}|[A-Za-z]\d{3}[A-Za-z]\d{4})(?![0-9])/g;
const MOBILE = /(?<!\d)(?:\+82[-\s]?(?:\(0\)[-\s]?|0)?1[016789]|01[016789])[-.\s]?\d{3,4}[-.\s]?\d{4}(?!\d)/g;
const AREA = "(?:2|[3-6][1-5]|70)";
const LANDLINE = new RegExp(
  `(?<!\\d)(?:\\+82[-\\s]?(?:\\(0\\)[-\\s]?)?${AREA}|\\(?0${AREA}\\)?)[-.\\s]?\\d{3,4}[-.\\s]?\\d{4}(?!\\d)`,
  "g",
);

/** 마스킹 후 텍스트에 남아 있으면 안 되는 패턴 (불변 조건 테스트용). */
export const PII_PATTERNS: RegExp[] = [
  /(?<!\d)\d{6}-[1-8]\d{6}(?!\d)/,
  /(?<!\d)\d{6}[1-8]\d{6}(?!\d)/,
  /(?<!\d)01[016789]-\d{3,4}-\d{4}(?!\d)/,
  /(?<!\d)0(?:2|[3-6][1-5]|70)-\d{3,4}-\d{4}(?!\d)/,
  /(?<!\d)4111-1111-1111-1111(?!\d)/,
];

function validDate(s: string): boolean {
  const y = Number(s.slice(0, 4)), m = Number(s.slice(4, 6));
  const d = s.length === 8 ? Number(s.slice(6, 8)) : 1;
  return y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31;
}

function looksLikeDateRange(m: string): boolean {
  const g = m.split("-");
  return g.length === 2 && g[0].length === g[1].length && (g[0].length === 6 || g[0].length === 8)
    && validDate(g[0]) && validDate(g[1]);
}

function validCardShape(m: string): boolean {
  const d = m.replace(/\D/g, "");
  if (d.length < 13 || d.length > 19) return false;
  if (!/[- ]/.test(m)) return d.length === 15 || d.length === 16;
  const groups = m.split(/[- ]/);
  // 연도 나열(예: 2010 2011 2012 2013)은 카드번호가 아니다.
  if (groups.every((g) => g.length === 4 && Number(g) >= 1900 && Number(g) <= 2100)) return false;
  const sig = groups.map((g) => g.length).join("-");
  if (/^4-4-4-4$|^4-6-4$|^4-6-5$/.test(sig)) return true;
  return /^4-4-4-[1-7]$/.test(sig);
}

export function maskText(input: string): { text: string; counts: Record<MaskKind, number> } {
  const counts: Record<MaskKind, number> = { rrn: 0, card: 0, account: 0, passport: 0, phone: 0 };
  let t = input.normalize("NFKC");

  t = t.replace(RRN, (m, a: string) => (validYYMMDD(a) ? (counts.rrn++, MARKERS.rrn) : m));
  t = t.replace(RRN_PARTIAL, (m, a: string) => (validYYMMDD(a) ? (counts.rrn++, MARKERS.rrn) : m));
  t = t.replace(CARD, (m) => {
    const d = m.replace(/\D/g, "");
    return validCardShape(m) && luhn(d) ? (counts.card++, MARKERS.card) : m;
  });
  const src = t;
  t = src.replace(ACCOUNT, (m, offset: number) => {
    const digits = m.replace(/\D/g, "").length;
    if (digits < 10 || digits > 16 || looksLikeDateRange(m)) return m;
    const lineStart = src.lastIndexOf("\n", offset - 1) + 1;
    const nl = src.indexOf("\n", offset);
    const line = src.slice(lineStart, nl === -1 ? src.length : nl);
    const before = src.slice(Math.max(0, offset - 30), offset);
    if (ACCOUNT_KW.test(line) || ACCOUNT_KW.test(before)) { counts.account++; return MARKERS.account; }
    return m;
  });
  t = t.split("\n").map((line) =>
    PASSPORT_KW.test(line) ? line.replace(PASSPORT, () => (counts.passport++, MARKERS.passport)) : line,
  ).join("\n");
  t = t.replace(MOBILE, () => (counts.phone++, MARKERS.phone));
  t = t.replace(LANDLINE, () => (counts.phone++, MARKERS.phone));
  return { text: t, counts };
}

export function sanitize(input: string): { text: SanitizedText; counts: Record<MaskKind, number>; markerRatio: number } {
  const { text, counts } = maskText(input);
  const markerChars = Object.entries(counts).reduce((n, [k, c]) => n + c * MARKERS[k as MaskKind].length, 0);
  const markerRatio = text.length === 0 ? 0 : markerChars / text.length;
  return { text: brandSanitized(text), counts, markerRatio };
}
