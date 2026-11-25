import { z } from "zod";

export const DOC_TYPES = ["과제", "보고서", "발표", "코드", "수상·증빙", "기타"] as const;
export const USE_FOR = ["이력서", "자소서", "포트폴리오"] as const;
export const VALUES = ["상", "중", "하"] as const;
export const IN_RESUME = ["반영됨", "부분반영", "미반영", "판단불가"] as const;
export const FORMATS = ["pdf", "docx", "pptx", "doc", "ppt", "md", "txt", "hwp", "hwpx", "git"] as const;

/** 추출 출력 상한(9.7 D). 넘치면 거부하지 않고 자른다. */
export const EXTRACT_LIMITS = { detailLines: 2, excerpts: 1, excerptChars: 100, skills: 8, metrics: 3 } as const;

const lines = (s: string) => s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

/** 1단계(추출) 응답 항목. 가치 판정(value, value_reason)은 2단계에서 원문 없이 한다(스펙 9.6). */
export const FileExtraction = z.object({
  id: z.string().min(1),
  type: z.enum(DOC_TYPES),
  use_for: z.array(z.enum(USE_FOR)),
  title: z.string().min(1).max(80),
  /** 한 줄: 첫 번째 비어 있지 않은 줄 */
  summary: z.string().transform((s) => lines(s)[0] ?? "").pipe(z.string().min(1)),
  detail: z.string().transform((s) => lines(s).slice(0, EXTRACT_LIMITS.detailLines).join("\n")),
  excerpts: z.array(z.string()).transform((a) => a.slice(0, EXTRACT_LIMITS.excerpts).map((e) => e.slice(0, EXTRACT_LIMITS.excerptChars))),
  period: z.string().nullable(),
  role: z.string().nullable(),
  skills: z.array(z.string()).transform((a) => a.slice(0, EXTRACT_LIMITS.skills)),
  metrics: z.array(z.string()).transform((a) => a.slice(0, EXTRACT_LIMITS.metrics)),
  org: z.string().nullable(),
  in_resume: z.enum(IN_RESUME),
});
export type FileExtraction = z.infer<typeof FileExtraction>;

/** 2단계(판정) 응답 항목 */
export const JudgeResult = z.object({
  id: z.string().min(1),
  value: z.enum(VALUES),
  value_reason: z.string().min(1),
});
export type JudgeResult = z.infer<typeof JudgeResult>;

export const FileCardFrontmatter = z.object({
  schema_version: z.literal(1),
  kind: z.literal("file"),
  source: z.string(),
  source_hash: z.string(),
  format: z.enum(FORMATS),
  size: z.number().int().nonnegative(),
  modified: z.string(),
  duplicates: z.array(z.string()),
  type: z.enum(DOC_TYPES),
  use_for: z.array(z.enum(USE_FOR)),
  title: z.string(),
  summary: z.string(),
  period: z.string().nullable(),
  role: z.string().nullable(),
  skills: z.array(z.string()),
  metrics: z.array(z.string()),
  org: z.string().nullable(),
  /** null = 미판정 (9.6) */
  value: z.enum(VALUES).nullable(),
  value_reason: z.string().nullable(),
  in_resume: z.enum(IN_RESUME),
  agent: z.string(),
  generated_at: z.string(),
});
export type FileCardFrontmatter = z.infer<typeof FileCardFrontmatter>;

export const REVIEW_STATES = ["pending", "adopted", "held", "excluded"] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];
export const CONTRIBUTIONS = ["직접 수행", "학습 후 재수행", "AI 보조", "AI 주도", "개념 해석"] as const;
export const CATEGORIES = ["프로젝트", "연구", "대회·CTF", "교육·수업", "동아리·스터디", "기타"] as const;
export type Category = (typeof CATEGORIES)[number];
/** 보강 질문이 채울 카드 필드(11.1). other는 필드에 바로 대응하지 않는 질문 */
export const QUESTION_FIELDS = ["period", "org", "role", "team_size", "skills", "metrics", "contribution", "other"] as const;

export const ExperienceQuestion = z.object({
  id: z.string().min(1),
  field: z.enum(QUESTION_FIELDS),
  q: z.string().min(1),
  /** null = 미응답, "모름" 허용(11.2). 저장 전에 sanitize() 한다 */
  a: z.string().nullable(),
});
export type ExperienceQuestion = z.infer<typeof ExperienceQuestion>;

/** 경험·성과 키워드 한도(11.5) */
export const KEYWORD_LIMITS = { keywords: 3, outcome: 2, chars: 18 } as const;

/** 경험 카드(10.3) */
export const ExperienceFrontmatter = z.object({
  schema_version: z.literal(1),
  kind: z.literal("experience"),
  title: z.string().min(1),
  type: z.enum(DOC_TYPES),
  period: z.string().nullable(),
  org: z.string().nullable(),
  role: z.string().nullable(),
  team_size: z.number().int().positive().nullable(),
  contribution: z.enum(CONTRIBUTIONS).nullable().default(null),
  category: z.enum(CATEGORIES).nullable().default(null),
  keywords: z.array(z.string()).default([]),
  outcome_keywords: z.array(z.string()).default([]),
  skills: z.array(z.string()),
  metrics: z.array(z.string()),
  value: z.enum(VALUES).nullable(),
  value_reason: z.string().nullable(),
  evidence: z.array(z.string()),
  in_resume: z.enum(IN_RESUME),
  review: z.enum(REVIEW_STATES),
  questions: z.array(ExperienceQuestion),
  pending_apply: z.boolean().default(false),
  reviewed_at: z.string().nullable(),
  agent: z.string(),
  generated_at: z.string(),
});
export type ExperienceFrontmatter = z.infer<typeof ExperienceFrontmatter>;

export const AgentConfig = z.object({
  command: z.string(),
  args: z.array(z.string()),
  env: z.record(z.string()).optional(),
  /** session/new 요청의 _meta로 그대로 전달 (Claude 도구 차단) */
  sessionMeta: z.record(z.unknown()).optional(),
  /** session/new 직후 session/set_mode로 설정할 모드 id */
  initialModeId: z.string().optional(),
});
export type AgentConfig = z.infer<typeof AgentConfig>;

export const Limits = z.object({
  maxFileBytes: z.number().int(),
  minTextBytes: z.number().int(),
  maxFileChars: z.number().int(),
  batchChars: z.number().int(),
  /** 더 쓰지 않음(9.7 A: 배치마다 새 세션). 기존 config.json 호환을 위해 남겨 둔다. */
  sessionRotateBatches: z.number().int().optional(),
  batchTimeoutMs: z.number().int(),
  homeDepth: z.number().int(),
  driveDepth: z.number().int(),
});

/** 단계별 모델 (9.6, 9.7 E). Claude는 ANTHROPIC_MODEL로, Codex는 codex가 있을 때만 CODEX_CONFIG.model로 전달. */
export const Models = z.object({
  /** 0단계 선별(9.7 E). 기존 config.json에 없으면 haiku */
  triage: z.string().min(1).default("haiku"),
  extract: z.string().min(1), judge: z.string().min(1), codex: z.string().min(1).optional(),
});
export type Models = z.infer<typeof Models>;
export const DEFAULT_FIVE_HOUR_SHARE = 0.3;
export const DEFAULT_MODELS: Models = { triage: "haiku", extract: "haiku", judge: "opus" };

/** 폴더 범위 판단(5.5). 키는 절대경로(normalizePath). */
export const ScopeDecision = z.object({
  decision: z.enum(["include", "exclude"]),
  by: z.enum(["llm", "user"]),
  at: z.string(),
});

export const Config = z.object({
  schema_version: z.literal(1),
  university: z.object({ input: z.string(), keywords: z.array(z.string()) }),
  scanFolders: z.array(z.string()),
  baselineFolder: z.string().nullable(),
  agent: z.string(),
  agents: z.record(AgentConfig),
  privacy: z.object({ allowPaths: z.array(z.string()) }),
  limits: Limits,
  /** 기존 config.json에 없으면 기본값 */
  models: Models.default(DEFAULT_MODELS),
  /** 사용량 예산(9.8): 한 번 실행이 쓸 5시간 창의 비율. 기존 config.json에 없으면 0.30 */
  /** fiveHourShare는 Pro 요금제 기준 비율. planScale = 내 요금제 5시간 창 / Pro 창(Max 5x면 5, 20x면 20). 측정 사용률 × planScale이 Pro 기준 사용량(9.8) */
  budget: z.object({
    fiveHourShare: z.number().gt(0).max(1).default(DEFAULT_FIVE_HOUR_SHARE),
    planScale: z.number().min(1).max(100).default(1),
  }).default({ fiveHourShare: DEFAULT_FIVE_HOUR_SHARE, planScale: 1 }),
  /** 폴더 범위 판단(5.5). 기존 config.json에 없으면 빈 목록 */
  scope: z.object({ decisions: z.record(ScopeDecision).default({}) }).default({ decisions: {} }),
});
export type Config = z.infer<typeof Config>;

export const FILE_STATUSES = ["done", "analysis_failed", "skipped_sensitive", "skipped_large", "skipped_long", "extract_failed", "duplicate", "skipped_irrelevant"] as const;
export type FileStatus = (typeof FILE_STATUSES)[number];

export const StateEntry = z.object({
  source_hash: z.string(),
  card: z.string().nullable(),
  card_body_hash: z.string().nullable(),
  card_snapshot: z.record(z.unknown()).nullable(),
  status: z.enum(FILE_STATUSES),
  /** 11.1: group이 어느 경험에도 넣지 않은 카드. --regroup 전까지 다시 보내지 않는다 */
  grouping: z.literal("ungrouped").optional(),
});
export type StateEntry = z.infer<typeof StateEntry>;

export const ExperienceStateEntry = z.object({ card_body_hash: z.string(), card_snapshot: z.record(z.unknown()) });
export type ExperienceStateEntry = z.infer<typeof ExperienceStateEntry>;

export const State = z.object({
  schema_version: z.literal(1),
  files: z.record(StateEntry),
  experiences: z.record(ExperienceStateEntry).default({}),
  last_scan: z.string().nullable(),
  /**
   * 해시 캐시(속도): 지난 스캔에서 해시를 계산한 파일의 크기·수정 시각. 둘 다 같으면 파일을 다시 읽지 않고 이 해시를 쓴다.
   * files와 따로 두어 카드 상태와 무관하게 동작하고, 매 스캔 이번에 본 파일로 새로 쓴다.
   */
  hash_cache: z.record(z.object({ hash: z.string(), size: z.number(), mtime_ms: z.number() })).optional(),
});
export type State = z.infer<typeof State>;
