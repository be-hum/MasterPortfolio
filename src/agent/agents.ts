import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import type { AgentConfig, Config } from "../core/schema.js";

/** Codex 설정 덮어쓰기: 쉘/exec, 이미지 보기, 앱·브라우저·컴퓨터 사용·플러그인·하위 에이전트, 웹 검색 끄기. */
const CODEX_LOCKDOWN = {
  "features.shell_tool": false,
  "features.unified_exec": false,
  "features.view_image": false,
  "features.apps": false,
  "features.browser_use": false,
  "features.in_app_browser": false,
  "features.computer_use": false,
  "features.code_mode_host": false,
  "features.plugins": false,
  "features.multi_agent": false,
  "features.image_generation": false,
  "features.hooks": false,
  web_search: "disabled",
};

export const DEFAULT_AGENTS: Record<string, AgentConfig> = {
  claude: {
    command: "npx",
    args: ["-y", "@agentclientprotocol/claude-agent-acp@0.110.1"],
    sessionMeta: {
      claudeCode: {
        options: {
          tools: [],
          settingSources: [],
          strictMcpConfig: true,
          disallowedTools: ["Read", "Bash", "Glob", "Grep", "Edit", "Write", "NotebookEdit", "WebFetch", "WebSearch", "Agent", "Task", "Skill"],
        },
      },
    },
    initialModeId: "default",
  },
  codex: {
    command: "npx",
    args: ["-y", "@agentclientprotocol/codex-acp@2.10.0"],
    env: { INITIAL_AGENT_MODE: "read-only", CODEX_CONFIG: JSON.stringify(CODEX_LOCKDOWN) },
  },
  // v1 제외 (M0: 작업공간 밖 read_file이 권한 요청 없이 실행됨). M3에서 재평가. init 목록에는 나오지 않는다.
  antigravity: { command: "agy", args: ["acp"] },
};

/** init에서 선택 가능한 에이전트 */
export const V1_AGENTS = ["claude", "codex"] as const;

/** 어댑터가 번들 CLI 대신 사용자가 설치한 공식 CLI를 쓰도록 하는 env 이름 */
const LOCAL_EXECUTABLE_ENV: Record<string, { bin: string; env: string }> = {
  claude: { bin: "claude", env: "CLAUDE_CODE_EXECUTABLE" },
  codex: { bin: "codex", env: "CODEX_PATH" },
};

export type ExecutableFinder = (finder: string, bin: string) => Promise<string>;
const execFinder: ExecutableFinder = async (finder, bin) =>
  (await promisify(execFile)(finder, [bin], { windowsHide: true })).stdout;

/**
 * 사용자가 설치한 claude/codex 실행 파일을 찾아 env에 넣는다. 못 찾거나 해당 없으면 그대로 반환.
 * Windows의 `where`는 claude(확장자 없는 sh 스크립트)·claude.cmd·claude.exe를 모두 돌려줄 수 있는데,
 * 어댑터는 이 경로를 직접 실행하므로 `.exe`만 쓴다. `.exe`가 없으면 env를 두지 않아 번들 CLI를 쓴다.
 */
export async function withLocalExecutable(
  name: string, cfg: AgentConfig,
  deps: { platform?: NodeJS.Platform; find?: ExecutableFinder } = {},
): Promise<AgentConfig> {
  const spec = LOCAL_EXECUTABLE_ENV[name];
  if (!spec) return cfg;
  const platform = deps.platform ?? process.platform;
  try {
    const stdout = await (deps.find ?? execFinder)(platform === "win32" ? "where" : "which", spec.bin);
    const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const path = platform === "win32" ? lines.find((l) => /\.exe$/i.test(l)) : lines[0];
    return path ? { ...cfg, env: { ...(cfg.env ?? {}), [spec.env]: path } } : cfg;
  } catch { return cfg; }
}

/** 폴더 범위(5.5) · 0단계 선별(9.7 E) · 1단계 추출 · 2단계 판정(9.6) · 경험 묶기·질의응답 반영(11.1, 11.2) */
export type Stage = "scope" | "triage" | "extract" | "judge" | "group" | "review" | "keywords";

/** 단계별 모델 이름. 폴더 범위는 models.triage, 경험 묶기·질의응답 반영은 models.judge(11.1, 11.2). */
export const modelForStage = (models: Config["models"], stage: Stage): string =>
  models[stage === "scope" || stage === "keywords" ? "triage" : stage === "group" || stage === "review" ? "judge" : stage];

/** 확장 사고를 끄는 요약·분류 단계(9.7 F). 판단 단계(judge·group·review)는 켜 둔다. */
const NO_THINKING_STAGES: ReadonlySet<Stage> = new Set(["scope", "triage", "extract", "keywords"]);

/**
 * 단계별 에이전트 실행 설정(스펙 9.6). 원본 config는 바꾸지 않고 복사본을 돌려준다.
 * - claude: 어댑터 env ANTHROPIC_MODEL = models[stage] (별칭이면 사용자 구독의 최신 모델)
 * - codex: models.codex가 있을 때만 CODEX_CONFIG의 model로 전달(단계 구분 없음), 없으면 사용자 설정 모델
 * - 그 외: 그대로
 */
export function agentForStage(config: Config, stage: Stage, deps: { exists?: (p: string) => boolean } = {}): AgentConfig {
  const base = config.agents[config.agent];
  if (!base) throw new Error(`에이전트 설정 없음: ${config.agent}`);
  const cfg = structuredClone(base);
  // 다른 환경(예: WSL)에서 기록한 로컬 CLI 경로가 이 PC에 없으면 빼서 어댑터가 자체 탐색·번들 CLI를 쓰게 한다
  const exists = deps.exists ?? existsSync;
  for (const k of Object.values(LOCAL_EXECUTABLE_ENV).map((x) => x.env)) {
    const p = cfg.env?.[k];
    if (p && !exists(p)) delete cfg.env![k];
  }
  if (config.agent === "claude") {
    cfg.env = { ...(cfg.env ?? {}), ANTHROPIC_MODEL: modelForStage(config.models, stage) };
    // 9.7 F: 요약·분류 단계는 확장 사고를 끈다(실측: 같은 응답 출력 토큰 약 750 → 286).
    // 어댑터는 _meta.claudeCode.options를 SDK 옵션으로 넘긴다. thinking:{type:"disabled"}와 env MAX_THINKING_TOKENS는 효과 없음(실측).
    if (NO_THINKING_STAGES.has(stage)) {
      const meta = (cfg.sessionMeta ?? {}) as { claudeCode?: { options?: Record<string, unknown> } };
      cfg.sessionMeta = { ...meta, claudeCode: { ...(meta.claudeCode ?? {}), options: { ...(meta.claudeCode?.options ?? {}), maxThinkingTokens: 0 } } };
    }
  } else if (config.agent === "codex" && config.models.codex) {
    let conf: unknown;
    try { conf = JSON.parse(cfg.env?.CODEX_CONFIG ?? "{}"); } catch { return cfg; } // 깨진 설정은 건드리지 않는다
    if (conf && typeof conf === "object" && !Array.isArray(conf)) {
      cfg.env = { ...(cfg.env ?? {}), CODEX_CONFIG: JSON.stringify({ ...conf, model: config.models.codex }) };
    }
  }
  return cfg;
}
