import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { FileCardFrontmatter } from "../../src/core/schema.js";
import { stringifyCard } from "../../src/store/frontmatter.js";
import { sha256String } from "../../src/core/hash.js";
import { emptyState, saveState } from "../../src/store/state.js";
import { defaultConfig, saveConfig } from "../../src/config/config.js";

const FAKE = resolve("test/fake-agent/fake-agent.ts");
const TSX = pathToFileURL(resolve("node_modules/tsx/dist/loader.mjs")).href;

/** 판정까지 끝난 파일 카드와 state, 가짜 에이전트 config를 만든다. 반환: 에이전트 로그 경로 */
export async function seedCards(out: string, cards: Partial<FileCardFrontmatter>[], scenario = "ok"): Promise<string> {
  const state = emptyState();
  await mkdir(join(out, "files"), { recursive: true });
  for (const [i, over] of cards.entries()) {
    const fm = FileCardFrontmatter.parse({
      schema_version: 1, kind: "file", source: `/src/f${i}.md`, source_hash: `sha256:${String(i).padStart(6, "0")}`, format: "md", size: 1000,
      modified: "2025-06-01", duplicates: [], type: "보고서", use_for: [], title: `카드 ${i}`, summary: `요약 ${i}`, period: null, role: null,
      skills: [], metrics: [], org: null, value: "상", value_reason: "근거", in_resume: "판단불가", agent: "claude", generated_at: "x", ...over,
    });
    const content = stringifyCard(fm, "## 상세 요약\n내용\n\n## 근거 발췌\n- 발췌\n");
    const rel = `files/card-${i}.md`;
    await writeFile(join(out, rel), content);
    state.files[fm.source] = { source_hash: fm.source_hash, card: rel, card_body_hash: sha256String(content), card_snapshot: fm as unknown as Record<string, unknown>, status: "done" };
  }
  await saveState(out, state);
  const c = defaultConfig({ university: { input: "", keywords: [] }, scanFolders: [], agent: "claude" });
  const log = join(out, "fake.jsonl");
  c.agents.claude = { command: process.execPath, args: ["--import", TSX, FAKE], env: { FAKE_AGENT_SCENARIO: scenario, FAKE_AGENT_LOG: log, FAKE_AGENT_STATE: join(out, "calls") } };
  await saveConfig(out, c);
  return log;
}
