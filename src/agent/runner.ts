import type { BudgetHooks, Stop } from "../analyzer/analyze.js";
import type { Config } from "../core/schema.js";
import { AcpBridge, AgentError } from "./bridge.js";
import { agentForStage, modelForStage, type Stage } from "./agents.js";
import { UsageMeter, formatResetsAt, pct } from "./budget.js";
import { progress } from "../core/progress.js";

export const BUDGET_DECLINED = "시작 시 사용률이 높아 사용자가 중단";
export const BUDGET_EXCEEDED = "사용량 예산 도달";

export type StageStats = { batches: number; prompts: number; chars: number };

/**
 * 한 번의 명령 실행에서 LLM 단계들이 함께 쓰는 것: 단계별 에이전트 프로세스(withBridge), 전송량 통계(9.6),
 * 사용량 예산(9.8, 모든 단계가 하나의 UsageMeter를 공유), 로그 줄 형식.
 */
export function createStageRunner(config: Config, o: {
  log: (line: string) => void;
  /** 프롬프트 전문 기록(--log-prompts). 없으면 기록하지 않음 */
  logPrompt?: ((text: string) => void) | null;
  budget?: number;
  yes?: boolean;
  ask: (msg: string) => Promise<boolean>;
  /** 안내 문구에 쓰는 재개 명령(예: "mp scan") */
  resumeCommand: string;
}) {
  const stage0 = (): StageStats => ({ batches: 0, prompts: 0, chars: 0 });
  const stats: Record<Stage, StageStats> = {
    scope: stage0(), triage: stage0(), extract: stage0(), judge: stage0(), group: stage0(), review: stage0(), keywords: stage0(),
  };
  const ranStages = new Set<Stage>();
  /** 단계별 소요 시간(에이전트 시작~종료, 여러 번 띄우면 합산) */
  const elapsed: Partial<Record<Stage, number>> = {};
  // 예산은 Pro 기준 비율. 내 요금제 창이 planScale배 크면 측정 사용률 기준 예산은 1/planScale(9.8)
  const scale = config.budget.planScale ?? 1;
  const meter = new UsageMeter((o.budget ?? config.budget.fiveHourShare) / scale);
  const proPct = (raw: number) => scale > 1 ? `${pct(raw * scale)}(Pro 기준, 실측 ${pct(raw)})` : pct(raw);
  const { log } = o;
  const modelLabel = (stage: Stage) =>
    config.agent === "claude" ? modelForStage(config.models, stage) : config.agent === "codex" && config.models.codex ? config.models.codex : "(에이전트 기본값)";
  const budgetStop = (): Stop => ({ kind: "budget", detail: BUDGET_EXCEEDED });

  return {
    meter, stats, ranStages,
    onBatchFor: (stage: Stage) => () => { stats[stage].batches++; },
    onPromptFor: (stage: Stage) => (t: string) => {
      stats[stage].prompts++; stats[stage].chars += t.length;
      o.logPrompt?.(t);
    },
    /** 실제로 보낸 배치(재시작 후 포함)·프롬프트(재요청 포함)·글자 수 */
    logStage: (stage: Stage) =>
      log(`[stage ${stage}] model=${modelLabel(stage)} batches=${stats[stage].batches} prompts=${stats[stage].prompts} chars=${stats[stage].chars}`),
    budgetStop,
    budgetHooks: (stage: Stage, bridge: AcpBridge): BudgetHooks => ({
      beforeBatch: async () => {
        if (meter.takeHighStartWarning()) {
          const msg = `5시간 사용량 창이 이미 ${Math.round((meter.start ?? 0) * 100)}% 사용되었습니다. 창 리셋(${formatResetsAt(meter.resetsAt)}) 후 실행을 권장합니다. 계속할까요?`;
          log(`[usage] high start utilization=${meter.start}`);
          if (!o.yes && !(await o.ask(msg))) return { kind: "budget", detail: BUDGET_DECLINED };
        }
        return meter.exceeded() ? budgetStop() : null;
      },
      onUsage: (u) => {
        if (u) meter.addTokens(stage, u);
        if (bridge.fiveHour) meter.observe(bridge.fiveHour);
        const tok = u ? `${u.inputTokens}/${u.outputTokens}/${u.cachedReadTokens}/${u.cachedWriteTokens}` : "-";
        log(`[usage] stage=${stage} tokens(in/out/cr/cw)=${tok} five_hour=${bridge.fiveHour ? bridge.fiveHour.utilization.toFixed(2) : "-"} spent=${meter.hasInfo ? meter.spent().toFixed(2) : "-"}${scale > 1 && meter.hasInfo ? ` spent_pro=${(meter.spent() * scale).toFixed(2)}` : ""}`);
      },
    }),
    /** budget 중단 안내(9.8). left: "남은 파일 3개" 같은 남은 작업 */
    budgetReason: (stop: Stop, left: string) => stop.detail === BUDGET_DECLINED
      ? `사용량이 이미 높아 중단 — 5시간 사용률 ${Math.round((meter.start ?? 0) * 100)}%, ${left}. 창 리셋(${formatResetsAt(meter.resetsAt)}) 후 \`${o.resumeCommand}\`으로 이어서 처리하세요.`
      : `사용량 예산 도달 — 사용 ${proPct(meter.spent())}, ${left}, 창 리셋 ${formatResetsAt(meter.resetsAt)}. 다음 \`${o.resumeCommand}\`에서 이어서 처리합니다.`,
    /** 단계마다 에이전트 프로세스를 새로 띄우고(모델이 다르므로), 끝나면 멈춘다. */
    withBridge: async (stage: Stage, work: (b: AcpBridge) => Promise<{ stopped: Stop | null }>): Promise<{ stopped: Stop | null }> => {
      // 예산을 이미 다 썼으면 에이전트를 띄우지 않는다(9.8)
      if (meter.exceeded()) return { stopped: budgetStop() };
      progress.begin(stage);
      const t0 = Date.now();
      const bridge = new AcpBridge(agentForStage(config, stage), { log });
      try {
        try { await bridge.start(); }
        catch (e) {
          const kind = e instanceof AgentError && (e.kind === "rate_limit" || e.kind === "auth") ? e.kind : "crash";
          return { stopped: { kind, detail: e instanceof Error ? e.message : String(e) } };
        }
        return await work(bridge);
      } finally {
        log(`[permissions denied] ${stage} ${bridge.deniedPermissions}`);
        await bridge.stop();
        elapsed[stage] = (elapsed[stage] ?? 0) + Date.now() - t0;
      }
    },
    /** 실행한 단계의 [stage …] 줄과, 사용률을 못 받았으면 그 사실을 남긴다 */
    logSummary: () => {
      for (const st of ranStages) {
        log(`[stage ${st}] model=${modelLabel(st)} batches=${stats[st].batches} prompts=${stats[st].prompts} chars=${stats[st].chars} ms=${elapsed[st] ?? 0}`);
      }
      if (ranStages.size && !meter.hasInfo) log("[usage] 사용률 정보 없음 — 사용량 예산을 적용하지 않았습니다");
    },
  };
}

export type StageRunner = ReturnType<typeof createStageRunner>;
