import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { FileCardFrontmatter, type JudgeResult, type State } from "../core/schema.js";
import { sha256String } from "../core/hash.js";
import { parseCard } from "../store/frontmatter.js";
import { runBatches, type BridgeLike, type BudgetHooks, type Stop } from "./analyze.js";
import { validateJudgeReply } from "./parse.js";
import { buildJudgePrompt, buildJudgeRetryPrompt } from "./prompt.js";

export const JUDGE_BATCH_SIZE = 40;

type JudgeFields = Pick<FileCardFrontmatter, "type" | "use_for" | "title" | "summary" | "period" | "role" | "skills" | "metrics" | "org"> & { detail: string };

/** 판정 입력 1건. `card`(카드 경로)는 결과를 되돌려 쓰기 위한 것이며 프롬프트에는 `fields`만 들어간다. */
export type JudgeItem = { id: string; card: string; fields: JudgeFields };

/** 카드 본문의 `## 상세 요약` 섹션(다음 `## ` 제목 전까지) */
function detailSection(body: string): string {
  const m = body.match(/^## 상세 요약[ \t]*\r?\n([\s\S]*?)(?=^## |(?![\s\S]))/m);
  return (m?.[1] ?? "").trim();
}

/** 카드 텍스트에서 판정 입력을 만든다. frontmatter가 카드 스키마에 맞지 않으면 null. */
function itemFromCard(text: string, relPath: string, id: string): { item: JudgeItem; fm: FileCardFrontmatter } | null {
  let parsed: ReturnType<typeof parseCard>;
  try { parsed = parseCard(text); } catch { return null; }
  const fm = FileCardFrontmatter.safeParse(parsed.fm);
  if (!fm.success) return null;
  const { type, use_for, title, summary, period, role, skills, metrics, org } = fm.data;
  return { item: { id, card: relPath, fields: { type, use_for, title, summary, period, role, skills, metrics, org, detail: detailSection(parsed.body) } }, fm: fm.data };
}

/**
 * 카드 파일에서 판정 입력을 만든다(스펙 9.6). frontmatter의 사실 필드와 상세 요약만 담고,
 * 원문·근거 발췌·원본 경로·해시는 넣지 않는다. 읽을 수 없거나 형식이 맞지 않으면 null.
 */
export async function loadJudgeItem(outputDir: string, relPath: string, id: string): Promise<JudgeItem | null> {
  let text: string;
  try { text = await readFile(join(outputDir, relPath), "utf8"); } catch { return null; }
  return itemFromCard(text, relPath, id)?.item ?? null;
}

export type Unjudged = {
  /** 판정에 보낼 카드 */
  items: JudgeItem[];
  /** 판정 id → state 키 */
  keyById: Map<string, string>;
  /** 미판정이지만 사용자가 편집(또는 보호)해 판정하지 않는 카드 */
  edited: string[];
  /** 미판정 카드 전체 수(편집된 카드 포함) */
  total: number;
};

/**
 * state에서 status done이고 카드 frontmatter value가 null인 카드를 모은다(이번 스캔과 이전 스캔 모두).
 * 편집 판정은 10.5 기준: card_body_hash가 없거나 현재 해시와 다르거나 __protected.
 */
export async function collectUnjudged(outputDir: string, state: State): Promise<Unjudged> {
  const res: Unjudged = { items: [], keyById: new Map(), edited: [], total: 0 };
  for (const [key, e] of Object.entries(state.files)) {
    if (e.status !== "done" || !e.card) continue;
    let text: string;
    try { text = await readFile(join(outputDir, e.card), "utf8"); } catch { continue; }
    const id = `c${res.items.length + 1}`;
    const got = itemFromCard(text, e.card, id);
    if (!got || got.fm.value !== null) continue;
    res.total++;
    const protectedCard = !!(e.card_snapshot as Record<string, unknown> | null)?.__protected;
    if (protectedCard || !e.card_body_hash || sha256String(text) !== e.card_body_hash) { res.edited.push(e.card); continue; }
    res.items.push(got.item);
    res.keyById.set(id, key);
  }
  res.edited.sort();
  return res;
}

/**
 * 2단계(판정). 배치·재요청·중단 규칙은 analyzeBatches와 같다(서비스 메시지 판별·회로 차단기 포함).
 * 재요청 뒤에도 빠진 카드는 미판정으로 남겨 다음 스캔에서 다시 판정한다.
 */
export async function judgeCards(bridge: BridgeLike, items: JudgeItem[], opts: {
  timeoutMs: number; batchSize: number;
  onJudged: (id: string, r: JudgeResult) => Promise<void>;
  onPrompt?: (text: string) => void;
  onBatch?: () => void;
  onUnparsed?: (text: string) => void;
} & BudgetHooks): Promise<{ stopped: Stop | null }> {
  const size = Math.max(1, opts.batchSize);
  const batches: JudgeItem[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return runBatches(bridge, batches, {
    buildPrompt: buildJudgePrompt, buildRetry: buildJudgeRetryPrompt, validate: validateJudgeReply,
  }, {
    timeoutMs: opts.timeoutMs,
    onResult: opts.onJudged, onFailed: async () => {},
    onPrompt: opts.onPrompt, onBatch: opts.onBatch, onUnparsed: opts.onUnparsed,
    beforeBatch: opts.beforeBatch, onUsage: opts.onUsage,
  });
}
