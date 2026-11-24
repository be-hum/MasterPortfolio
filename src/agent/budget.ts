import type { FiveHour, TokenUsage } from "./usage.js";

/**
 * 한 번의 명령 실행 동안 5시간 사용량 창 소비를 잰다(스펙 9.8).
 * 사용량 = Σ(창별 마지막 값 − 그 창의 시작값). 첫 창의 시작값은 처음 받은 값(u0), 리셋된 새 창은 0.
 */
export class UsageMeter {
  /** 처음 받은 utilization(u0). 아직 못 받았으면 null */
  start: number | null = null;
  /** 마지막으로 받은 값 */
  last: FiveHour | null = null;
  private windows = new Map<string, { start: number; last: number }>();
  private highStartPending = false;
  tokens: Record<string, TokenUsage> = {};

  constructor(readonly share: number) {}

  get hasInfo(): boolean { return this.start !== null; }
  get resetsAt(): number | null { return this.last?.resetsAt ?? null; }

  observe(f: FiveHour): void {
    const key = String(f.resetsAt);
    const w = this.windows.get(key);
    if (w) w.last = f.utilization;
    else {
      const first = this.start === null;
      this.windows.set(key, { start: first ? f.utilization : 0, last: f.utilization });
      if (first) {
        this.start = f.utilization;
        this.highStartPending = f.utilization >= 1 - this.share;
      }
    }
    this.last = f;
  }

  spent(): number {
    let s = 0;
    for (const w of this.windows.values()) s += Math.max(0, w.last - w.start);
    return Math.round(s * 10000) / 10000;
  }

  exceeded(): boolean { return this.hasInfo && this.spent() >= this.share; }

  /** 처음 받은 값이 이미 1 − share 이상이면 한 번만 true(시작 시 경고, 9.8) */
  takeHighStartWarning(): boolean {
    const p = this.highStartPending;
    this.highStartPending = false;
    return p;
  }

  addTokens(stage: string, u: TokenUsage): void {
    const t = (this.tokens[stage] ??= { inputTokens: 0, outputTokens: 0, cachedReadTokens: 0, cachedWriteTokens: 0, totalTokens: 0 });
    t.inputTokens += u.inputTokens; t.outputTokens += u.outputTokens;
    t.cachedReadTokens += u.cachedReadTokens; t.cachedWriteTokens += u.cachedWriteTokens; t.totalTokens += u.totalTokens;
  }
}

/** 유닉스 초 → 로컬 "YYYY-MM-DD HH:mm" */
export function formatResetsAt(sec: number | null): string {
  if (sec === null) return "알 수 없음";
  const d = new Date(sec * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export const pct = (x: number) => `${Math.round(x * 1000) / 10}%p`;
