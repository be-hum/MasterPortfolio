export type SanitizedText = string & { readonly __brand: "SanitizedText" };
/** privacy/mask.ts 외부에서 호출 금지. */
export const brandSanitized = (s: string) => s as SanitizedText;

/** 본문 상한(9.7 C): 앞 3,500자 + 표식 + 끝 500자. 4,000자 이하면 전문. */
export const TRUNCATE_HEAD = 3500;
export const TRUNCATE_TAIL = 500;
export const TRUNCATE_MARK = "\n…(중략)…\n";

/**
 * 이미 마스킹된 텍스트를 자른다. 마스킹된 전문의 부분 문자열과 고정 표식만 이어 붙이므로 SanitizedText로 남는다.
 * (자르기 전에 전문을 마스킹해야 경계에 걸친 개인정보가 새지 않는다.)
 */
export function truncateSanitized(t: SanitizedText, head = TRUNCATE_HEAD, tail = TRUNCATE_TAIL): SanitizedText {
  if (t.length <= head + tail) return t;
  return (t.slice(0, head) + TRUNCATE_MARK + t.slice(t.length - tail)) as SanitizedText;
}

/** 마스킹된 텍스트의 앞 n자(선별 단계 입력, 9.7 E) */
export const headSanitized = (t: SanitizedText, n: number): SanitizedText => t.slice(0, n) as SanitizedText;
