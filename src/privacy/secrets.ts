/**
 * 계정 비밀값 본문 검사(스펙 8.2 보강, 2026-11-24 실기 스캔에서 2FA 복구 코드 파일이 전송된 사고 대응).
 * 걸리면 파일 전체를 전송하지 않는다(skipped_sensitive). 마스킹이 아니라 건너뛰기인 이유: 코드 목록·키는
 * 형식이 다양해 일부만 가리면 나머지가 새기 쉽다.
 */
const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;

const TOKEN_RES = [
  /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}/,
  /\bgithub_pat_[A-Za-z0-9_]{40,}/,
  // OpenAI·Anthropic 키. URL·단어 안의 sk-(예: news.sk-hynix.com)는 제외, 숫자가 섞인 32자 이상만
  /(?<![\w./-])sk-(ant-|proj-)?(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{32,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bAIza[0-9A-Za-z_-]{35}/,
];

const CODE_KEYWORDS = /(backup|recovery)[\s_-]*codes?|(복구|백업)\s*코드/i;

/** 코드 하나: 숫자가 하나 이상 든 4~5자 + (구분자) + 4~5자. 예: a1b2c-3d4e5, 1234 5678 */
const CODE = String.raw`(?:\d{1,2}[.)]\s*)?(?=[A-Za-z0-9 -]*\d)[A-Za-z0-9]{4,5}[- ]?[A-Za-z0-9]{4,5}`;
const CODE_LINE = new RegExp(String.raw`^\s*${CODE}(?:\s+${CODE})?\s*$`);
/** 각 코드 조각에 숫자가 있어야 한다(일반 단어 두 개 줄 제외) */
const hasDigitPerCode = (line: string) => line.trim().split(/\s{2,}|\t/).every((part) => /\d/.test(part.replace(/^\d{1,2}[.)]\s*/, "")));
const CODE_LIST_MIN = 5;

export type SecretKind = "개인 키" | "API 키·토큰" | "복구 코드";

export function detectSecret(text: string): SecretKind | null {
  if (PRIVATE_KEY.test(text)) return "개인 키";
  if (TOKEN_RES.some((r) => r.test(text))) return "API 키·토큰";
  if (CODE_KEYWORDS.test(text.slice(0, 3000))) return "복구 코드";
  let n = 0;
  for (const line of text.split(/\r?\n/)) {
    if (CODE_LINE.test(line) && hasDigitPerCode(line) && ++n >= CODE_LIST_MIN) return "복구 코드";
  }
  return null;
}
