import { normalizePath } from "../core/paths.js";

const KEYWORDS = [
  "주민등록", "등본", "초본", "가족관계", "통장사본", "통장 사본", "신분증", "여권사본", "운전면허",
  "계약서", "근로계약", "임대차", "원천징수", "소득금액", "납세", "건강보험", "진단서", "처방전",
  "여권", "passport", "id_card",
];

/** 계정 비밀 파일 이름(파일 이름 기준, 대소문자 무시). 사고 대응 2026-11-24: 2FA 복구 코드·키 파일. */
const SECRET_NAME_RES: { re: RegExp; reason: string }[] = [
  { re: /(backup|recovery)[-_ ]?codes?/i, reason: "복구 코드 파일" },
  { re: /(복구|백업)[ _-]?코드/, reason: "복구 코드 파일" },
  { re: /(^|[-_ .])(2fa|otp|mfa)([-_ .]|$)/i, reason: "2단계 인증 파일" },
  { re: /(^|[-_ .])((api|secret|access|private)[-_ ]?)?key\.(txt|md|json)$/i, reason: "키 파일" },
  { re: /\.(pem|key|p12|pfx|kdbx)$/i, reason: "키 파일" },
  { re: /^id_(rsa|ed25519|ecdsa|dsa)/i, reason: "키 파일" },
  // 접미어는 한 단어까지만(passwords-2024.txt). password-cracking-report.md 같은 보고서는 남긴다.
  { re: /^(my[-_ ]?)?(passwords?|passwd|비밀번호|패스워드)([-_ ][^.\-_ ]{0,12})?\.(txt|md|json)$/i, reason: "비밀번호 파일" },
  { re: /^(credentials?|secrets?)([-_ ][^.\-_ ]{0,12})?\.(txt|md|json)$/i, reason: "자격 증명 파일" },
];
/** 폴더 이름(경로 조각과 정확히 일치) */
const SECRET_DIRS = ["중요자료"];

export function isSensitivePath(absPath: string, allowPaths: string[]): string | null {
  const p = normalizePath(absPath);
  if (allowPaths.map(normalizePath).includes(p)) return null;
  const lower = p.toLowerCase();
  for (const k of KEYWORDS) if (lower.includes(k.toLowerCase())) return k;
  const parts = p.split("/");
  const base = parts[parts.length - 1] ?? "";
  for (const { re, reason } of SECRET_NAME_RES) if (re.test(base)) return reason;
  for (const d of SECRET_DIRS) if (parts.slice(0, -1).includes(d)) return `${d} 폴더`;
  return null;
}

/** 폴더 경로 자체가 민감한가(폴더 범위 단계 5.5: 이런 폴더는 에이전트로 보내지 않는다). 키워드·중요자료·비밀 파일식 이름. */
export function isSensitiveDir(absPath: string): string | null {
  const p = normalizePath(absPath).replace(/\/+$/, "");
  const lower = p.toLowerCase();
  for (const k of KEYWORDS) if (lower.includes(k.toLowerCase())) return k;
  const parts = p.split("/");
  for (const d of SECRET_DIRS) if (parts.includes(d)) return `${d} 폴더`;
  const base = parts[parts.length - 1] ?? "";
  for (const { re, reason } of SECRET_NAME_RES) if (re.test(base)) return reason;
  return null;
}
