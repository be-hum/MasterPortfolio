/**
 * 작업 진행률 보고(mp ui 작업 바용). 환경변수 MP_PROGRESS=1일 때만 stdout에 한 줄씩 낸다:
 *   @@progress {"stage":"extract","done":3,"total":7}
 * 터미널에서 직접 실행할 때는 아무것도 출력하지 않는다.
 *
 * - 단계 이름은 runner.withBridge가 begin()으로 정한다. 같은 단계가 이어서 다시 시작되면(에이전트 재시작)
 *   앞서 끝낸 수를 이어서 센다.
 * - override()로 단계 이름을 바꿀 수 있다(스캔 시작 때 이전 카드 판정을 "judge-pending"으로 따로 셈).
 */
export const PROGRESS_PREFIX = "@@progress ";
export const SUMMARY_PREFIX = "@@summary ";
const enabled = () => process.env.MP_PROGRESS === "1";

let label: string | null = null;
let override: string | null = null;
let carried = 0, lastDone = 0, lastTotal = 0;

export type ProgressEvent = { stage: string; done: number; total: number };

export const progress = {
  /** 단계 시작(같은 단계가 연달아 시작되면 이어서 센다) */
  begin(stage: string): void {
    const l = override ?? stage;
    carried = l === label ? carried + lastDone : 0;
    label = l; lastDone = 0; lastTotal = 0;
  },
  /** 다음 begin()부터 쓸 단계 이름. null이면 원래 이름 */
  override(name: string | null): void { override = name; },
  /** 지금 단계에서 done/total 묶음 */
  report(done: number, total: number): void {
    lastDone = done; lastTotal = total;
    if (process.env.MP_PROGRESS !== "1" || !label) return;
    const ev: ProgressEvent = { stage: label, done: carried + done, total: carried + total };
    process.stdout.write(PROGRESS_PREFIX + JSON.stringify(ev) + "\n");
  },
  /** LLM 묶음이 아닌 로컬 단계(파일 찾기·확인). total 0이면 개수만(전체 미정) */
  local(stage: string, done: number, total: number): void {
    if (!enabled()) return;
    process.stdout.write(PROGRESS_PREFIX + JSON.stringify({ stage, done, total } satisfies ProgressEvent) + "\n");
  },
  /** 작업 결과 한 줄 요약(화면 알림·작업 바) */
  summary(text: string): void {
    if (!enabled()) return;
    process.stdout.write(SUMMARY_PREFIX + text.replace(/\r?\n/g, " ") + "\n");
  },
  /** 테스트용 초기화 */
  reset(): void { label = null; override = null; carried = 0; lastDone = 0; lastTotal = 0; },
};

/** 작업 종류별 단계 순서와 무게(전체 % 계산). 스캔은 추출이 가장 오래 걸린다 */
export const JOB_PLANS: Record<string, [string, number][]> = {
  // 실제 순서: 파일 찾기 → 폴더 범위 → (범위 정리로 제외가 생기면 다시 찾기) → 파일 확인(해시) → 이전 카드 판정 → 선별 → 추출 → 판정
  scan: [["walk", 0.04], ["scope", 0.05], ["hash", 0.06], ["judge-pending", 0.08], ["triage", 0.12], ["extract", 0.45], ["judge", 0.2]],
  group: [["group", 1]],
  apply: [["review", 1]],
  keywords: [["keywords", 1]],
};

/** 전체 진행률 0~1. 계획에 없는 단계면 null. 계획에서 앞선 단계는 끝난 것으로 본다(건너뛴 단계 포함) */
export function overallProgress(kind: string, ev: ProgressEvent): number | null {
  const plan = JOB_PLANS[kind];
  const i = plan?.findIndex(([s]) => s === ev.stage) ?? -1;
  if (!plan || i < 0) return null;
  const sum = plan.reduce((n, [, w]) => n + w, 0);
  const before = plan.slice(0, i).reduce((n, [, w]) => n + w, 0);
  const frac = ev.total > 0 ? Math.min(1, ev.done / ev.total) : 0;
  return (before + plan[i][1] * frac) / sum;
}

/** 남은 시간(초) 추정: 전체 진행률이 15% 이상이고 20초 넘게 지났을 때만 */
export function etaSeconds(overall: number | null, elapsedMs: number): number | null {
  if (overall === null || overall < 0.15 || overall >= 1 || elapsedMs < 20_000) return null;
  return Math.round((elapsedMs / 1000) * (1 - overall) / overall);
}
