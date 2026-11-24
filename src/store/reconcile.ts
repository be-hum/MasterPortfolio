import { access, readdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import type { State } from "../core/schema.js";
import { sha256String } from "../core/hash.js";
import { parseCard } from "./frontmatter.js";
import { loadState, saveState } from "./state.js";

export type Issue =
  | { kind: "restore"; key: string; card: string }
  | { kind: "edited"; key: string; card: string; changedFields: string[] }
  | { kind: "orphan_state"; key: string; card: string }
  | { kind: "source_missing"; key: string; card: string };

export type Decision = { protect: boolean } | { keep: boolean };

/** 원본이 확실히 없을 때만 true: ENOENT이고 상위 폴더는 존재해야 한다(드라이브/공유 오프라인 구분). */
async function definitelyMissing(p: string): Promise<boolean> {
  try { await access(p); return false; }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") return false;
  }
  try { return (await stat(dirname(p))).isDirectory(); } catch { return false; }
}
const IGNORED = new Set(["generated_at"]);

function safeParse(text: string): { fm: Record<string, unknown>; body: string } | null {
  try { return parseCard(text); } catch { return null; }
}

export async function checkConsistency(outputDir: string): Promise<{ state: State; problem: "missing" | "corrupt" | null; issues: Issue[] }> {
  const { state, problem } = await loadState(outputDir);
  const issues: Issue[] = [];
  let names: string[] = [];
  try { names = (await readdir(join(outputDir, "files"))).filter((n) => n.endsWith(".md")); } catch { /* 없음 */ }
  const cardToKey = new Map(Object.entries(state.files).filter(([, e]) => e.card).map(([k, e]) => [e.card!, k]));

  for (const n of names) {
    const rel = `files/${n}`;
    let text: string;
    try { text = await readFile(join(outputDir, rel), "utf8"); } catch { continue; }
    const key = cardToKey.get(rel);
    if (!key) {
      const parsed = safeParse(text);
      if (parsed && typeof parsed.fm.source === "string") issues.push({ kind: "restore", key: parsed.fm.source, card: rel });
      continue;
    }
    const e = state.files[key];
    const protectedCard = !!(e.card_snapshot as Record<string, unknown> | null | undefined)?.__protected;
    const edited = !!e.card_body_hash && sha256String(text) !== e.card_body_hash;
    if (edited && !protectedCard) {
      const parsed = safeParse(text);
      if (!parsed) { issues.push({ kind: "edited", key, card: rel, changedFields: ["(형식 오류)"] }); continue; }
      const fm = parsed.fm;
      const snap = (e.card_snapshot ?? {}) as Record<string, unknown>;
      const changedFields = Object.keys({ ...snap, ...fm })
        .filter((k) => !IGNORED.has(k) && !k.startsWith("__") && JSON.stringify(snap[k]) !== JSON.stringify(fm[k]));
      issues.push({ kind: "edited", key, card: rel, changedFields: changedFields.length ? changedFields : ["(본문)"] });
      continue;
    }
    if (edited || protectedCard) continue; // 사용자 편집/보호 카드는 삭제 질의 대상이 아님
    if (await definitelyMissing(key)) issues.push({ kind: "source_missing", key, card: rel });
  }
  const restoreKeys = new Set(issues.filter((i) => i.kind === "restore").map((i) => i.key));
  for (const [key, e] of Object.entries(state.files)) {
    if (e.card && !restoreKeys.has(key) && !names.includes(e.card.replace(/^files\//, ""))) issues.push({ kind: "orphan_state", key, card: e.card });
  }
  return { state, problem, issues };
}

export async function applyReconciliation(outputDir: string, state: State, issues: Issue[], decide: (i: Issue) => Promise<boolean>): Promise<State> {
  const next: State = structuredClone(state);
  for (const i of issues) {
    if (i.kind === "restore") {
      let parsed: ReturnType<typeof safeParse> = null;
      let text = "";
      try { text = await readFile(join(outputDir, i.card), "utf8"); parsed = safeParse(text); } catch { /* 건너뜀 */ }
      if (!parsed) continue;
      const fm = parsed.fm;
      // 미판정 카드(value null)는 현재 해시를 기록하고 보호하지 않는다 → 다음 판정 단계에서 판정된다(9.6).
      // 판정된 카드는 사용자 편집 여부를 알 수 없으므로 보수적으로 보호한다.
      const unjudged = fm.value === null;
      next.files[i.key] = {
        source_hash: String(fm.source_hash ?? ""), card: i.card, card_body_hash: unjudged ? sha256String(text) : null,
        card_snapshot: unjudged ? { ...fm } : { ...fm, __protected: true }, status: "done",
      };
      continue;
    }
    const yes = await decide(i);
    if (i.kind === "edited") {
      const e = next.files[i.key];
      if (yes) e.card_snapshot = { ...(e.card_snapshot ?? {}), __protected: true };
      else {
        try { e.card_body_hash = sha256String(await readFile(join(outputDir, i.card), "utf8")); } catch { /* 건너뜀 */ }
      }
    } else if (i.kind === "orphan_state") {
      if (yes && next.files[i.key]?.card === i.card) delete next.files[i.key];
    } else if (i.kind === "source_missing") {
      if (!yes) {
        const filesDir = resolve(outputDir, "files") + sep;
        const target = resolve(outputDir, i.card);
        if (!target.startsWith(filesDir)) continue; // files/ 밖은 삭제하지 않음
        await rm(target, { force: true });
        delete next.files[i.key];
      }
    }
  }
  await saveState(outputDir, next);
  return next;
}
