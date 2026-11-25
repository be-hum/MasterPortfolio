import { normalizePath, pathKey } from "../core/paths.js";

/** 폴더 범위 판단 1건(5.5). config.json `scope.decisions`의 값. */
export type ScopeDecision = { decision: "include" | "exclude"; by: "llm" | "user"; at: string };
/** 키: 절대경로(normalizePath) */
export type ScopeDecisions = Record<string, ScopeDecision>;

/** pathKey의 바로 위 폴더 키. 루트("/", "c:/")면 null. */
function parentKey(k: string): string | null {
  const i = k.lastIndexOf("/");
  if (i < 0) return null;
  const head = k.slice(0, i);
  const next = i === 0 ? "/" : /^[A-Za-z]:$/.test(head) ? head + "/" : head;
  return next === k ? null : next;
}

/** 저장 키: normalizePath + 끝 슬래시 제거(대소문자는 그대로) */
export function decisionKey(p: string): string {
  let s = normalizePath(p);
  while (s.length > 1 && s.endsWith("/") && !/^[A-Za-z]:\/$/.test(s)) s = s.slice(0, -1);
  return s;
}

const under = (k: string, root: string) => k.startsWith(root.endsWith("/") ? root : root + "/");

/**
 * 순회에 적용할 판단 조회(5.5 적용). 경로 비교는 pathKey(대소문자 무시 파일시스템은 소문자)로 한다.
 * - decisionFor: 가장 가까운 상위(자기 포함) 판단. 없으면 null.
 * - includeBelow: 이 폴더 아래(자기 제외)에 include 판단이 있는가. exclude 폴더를 그 include까지만 내려가는 데 쓴다.
 */
export function scopeResolver(decisions: ScopeDecisions, platform: NodeJS.Platform = process.platform) {
  const byKey = new Map<string, ScopeDecision["decision"]>();
  for (const [p, d] of Object.entries(decisions)) byKey.set(pathKey(p, platform), d.decision);
  const includes = [...byKey].filter(([, d]) => d === "include").map(([k]) => k);
  return {
    decisionFor(p: string): ScopeDecision["decision"] | null {
      for (let k: string | null = pathKey(p, platform); k !== null; k = parentKey(k)) {
        const d = byKey.get(k);
        if (d) return d;
      }
      return null;
    },
    includeBelow(p: string): boolean {
      const k = pathKey(p, platform);
      return includes.some((ik) => ik !== k && under(ik, k));
    },
  };
}

/** 이미 저장된 같은 경로(대소문자만 다른 것 포함)의 키 */
export function findDecisionKey(decisions: Record<string, unknown>, p: string, platform: NodeJS.Platform = process.platform): string | null {
  const k = pathKey(p, platform);
  return Object.keys(decisions).find((x) => pathKey(x, platform) === k) ?? null;
}

/** 판단 저장. LLM은 사용자 판단(by: user)을 덮어쓰지 않는다(false 반환). */
export function setScopeDecision(
  decisions: ScopeDecisions, p: string, decision: ScopeDecision["decision"], by: ScopeDecision["by"], at: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const existing = findDecisionKey(decisions, p, platform);
  if (existing && by === "llm" && decisions[existing].by === "user") return false;
  const key = existing ?? decisionKey(p);
  decisions[key] = { decision, by, at };
  return true;
}

/** `mp scope --reset <경로>`: 그 경로와 하위 판단을 지운다. 지운 키 목록. */
export function resetScopeDecisions(decisions: Record<string, unknown>, p: string, platform: NodeJS.Platform = process.platform): string[] {
  const k = pathKey(p, platform);
  const removed = Object.keys(decisions).filter((x) => { const xk = pathKey(x, platform); return xk === k || under(xk, k); });
  for (const x of removed) delete decisions[x];
  return removed;
}
