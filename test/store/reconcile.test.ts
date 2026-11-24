import { describe, it, expect } from "vitest";
import { readFile, writeFile, rm, rename } from "node:fs/promises";
import { join } from "node:path";
import { checkConsistency, applyReconciliation } from "../../src/store/reconcile.js";
import { writeFileCard } from "../../src/store/cards.js";
import { saveState, emptyState, loadState } from "../../src/store/state.js";
import { mkTmp } from "../helpers/tmp.js";
import { sha256String } from "../../src/core/hash.js";

const analysis = {
  id: "f1", type: "보고서" as const, use_for: [], title: "보고서", summary: "요약", detail: "d", excerpts: [],
  period: null, role: null, skills: [], metrics: [], org: null, in_resume: "판단불가" as const,
};

async function setup() {
  const d = await mkTmp(); const src = join(d, "src.md");
  await writeFile(src, "x".repeat(300));
  const cand = { path: src, key: src.replace(/\\/g, "/"), format: "md" as const, size: 300, mtimeMs: 0, hash: "sha256:aaaaaa11", duplicates: [] };
  const { relPath, entry } = await writeFileCard(d, cand, analysis, "claude");
  const st = emptyState(); st.files[cand.key] = entry; await saveState(d, st);
  return { d, relPath, key: cand.key, src };
}

describe("reconcile", () => {
  it("no issues on a clean store", async () => {
    const { d } = await setup();
    expect((await checkConsistency(d)).issues).toEqual([]);
  });

  it("detects edited card with changed fields", async () => {
    const { d, relPath } = await setup();
    const p = join(d, relPath);
    await writeFile(p, (await readFile(p, "utf8")).replace("value: null", "value: 상"));
    const { issues } = await checkConsistency(d);
    expect(issues).toEqual([expect.objectContaining({ kind: "edited", changedFields: ["value"] })]);
  });

  it("restores state from cards when state.json is missing", async () => {
    const { d, key } = await setup();
    await rm(join(d, ".mp", "state.json"));
    const { state, problem, issues } = await checkConsistency(d);
    expect(problem).toBe("missing");
    expect(issues.map((i) => i.kind)).toEqual(["restore"]);
    const next = await applyReconciliation(d, state, issues, async () => true);
    expect(next.files[key].source_hash).toBe("sha256:aaaaaa11");
    expect((await loadState(d)).state.files[key]).toBeDefined();
  });

  it("source missing + user chooses delete removes the card", async () => {
    const { d, relPath, src, key } = await setup();
    await rm(src);
    const { state, issues } = await checkConsistency(d);
    expect(issues.map((i) => i.kind)).toEqual(["source_missing"]);
    const next = await applyReconciliation(d, state, issues, async () => false);
    expect(next.files[key]).toBeUndefined();
    await expect(readFile(join(d, relPath))).rejects.toThrow();
  });

  it("tracked card with broken YAML is reported as edited (형식 오류), not thrown", async () => {
    const { d, relPath } = await setup();
    await writeFile(join(d, relPath), "---\ntitle: [unclosed\n  : : bad\n---\nbody\n");
    const { issues } = await checkConsistency(d);
    expect(issues).toEqual([expect.objectContaining({ kind: "edited", changedFields: ["(형식 오류)"] })]);
  });

  it("untracked card with broken YAML or no source is skipped; restore tolerates parse failure", async () => {
    const { d, relPath } = await setup();
    await rm(join(d, ".mp", "state.json"));
    await writeFile(join(d, "files", "broken.md"), "---\ntitle: [unclosed\n---\nx\n");
    await writeFile(join(d, "files", "nosrc.md"), "---\ntitle: t\n---\nx\n");
    const { state, issues } = await checkConsistency(d);
    expect(issues.map((i) => i.card)).toEqual([relPath]);
    const forced = [...issues, { kind: "restore" as const, key: "k", card: "files/broken.md" }];
    const next = await applyReconciliation(d, state, forced, async () => true);
    expect(Object.keys(next.files)).toHaveLength(1);
  });

  it("source in a non-existent parent dir is not source_missing", async () => {
    const { d, key } = await setup();
    const st = (await loadState(d)).state;
    const moved = join(d, "gone-drive", "src.md").replace(/\\/g, "/");
    st.files[moved] = st.files[key]; delete st.files[key];
    await saveState(d, st);
    expect((await checkConsistency(d)).issues).toEqual([]);
  });

  it("protected card with missing source is not source_missing", async () => {
    const { d, src, key } = await setup();
    const st = (await loadState(d)).state;
    st.files[key].card_snapshot = { ...(st.files[key].card_snapshot ?? {}), __protected: true };
    await saveState(d, st);
    await rm(src);
    expect((await checkConsistency(d)).issues).toEqual([]);
  });

  it("renamed card yields a single restore and apply points state at new name", async () => {
    const { d, relPath, key } = await setup();
    await rename(join(d, relPath), join(d, "files", "renamed.md"));
    const { state, issues } = await checkConsistency(d);
    expect(issues).toEqual([{ kind: "restore", key, card: "files/renamed.md" }]);
    const next = await applyReconciliation(d, state, issues, async () => true);
    expect(next.files[key].card).toBe("files/renamed.md");
  });

  it("never deletes a card path outside files/", async () => {
    const { d, key } = await setup();
    const outside = join(d, "outside.md");
    await writeFile(outside, "keep");
    const st = (await loadState(d)).state;
    st.files[key].card = "../outside.md";
    await applyReconciliation(d, st, [{ kind: "source_missing", key, card: "../outside.md" }], async () => false);
    expect(await readFile(outside, "utf8")).toBe("keep");
  });

  it("restores an unjudged card unprotected with its current hash, so it can be judged; judged cards stay protected", async () => {
    const { d, key, relPath } = await setup();
    try {
    await rm(join(d, ".mp", "state.json"));
    const { state, issues } = await checkConsistency(d);
    const next = await applyReconciliation(d, state, issues, async () => true);
    const text = await readFile(join(d, relPath), "utf8");
    expect(next.files[key].card_body_hash).toBe(sha256String(text));
    expect((next.files[key].card_snapshot as any).__protected).toBeUndefined();
    expect((next.files[key].card_snapshot as any).value).toBeNull();
    expect((await checkConsistency(d)).issues).toEqual([]);

    const p = join(d, relPath);
    await writeFile(p, text.replace("value: null", "value: 상").replace("value_reason: null", "value_reason: r"));
    await rm(join(d, ".mp", "state.json"));
    const c2 = await checkConsistency(d);
    const n2 = await applyReconciliation(d, c2.state, c2.issues, async () => true);
    expect(n2.files[key].card_body_hash).toBeNull();
    expect((n2.files[key].card_snapshot as any).__protected).toBe(true);
    } finally { await rm(d, { recursive: true, force: true }); }
  });
});
