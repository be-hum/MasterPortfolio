import { describe, it, expect, afterEach } from "vitest";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { prefilter } from "../../src/scan/prefilter.js";
import { defaultConfig } from "../../src/config/config.js";
import { sha256File } from "../../src/core/hash.js";
import { normalizePath } from "../../src/core/paths.js";
import { mkTmp } from "../helpers/tmp.js";

const limits = defaultConfig({ university: { input: "", keywords: [] }, scanFolders: [], agent: "claude" }).limits;
const emptyState = { schema_version: 1 as const, files: {}, last_scan: null };

async function file(dir: string, name: string, content: string | Buffer) {
  const p = join(dir, name); await writeFile(p, content);
  const size = Buffer.byteLength(content as any);
  return { kind: "file" as const, path: p, size, mtimeMs: 0 };
}

const made: string[] = [];
const tmp = async () => { const d = await mkTmp(); made.push(d); return d; };

describe("prefilter", () => {
  afterEach(async () => { await Promise.all(made.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });
  it("filters by extension, size, tiny text, and dedupes by hash", async () => {
    const d = await tmp();
    const long = "가".repeat(300);
    const entries = [
      await file(d, "a.md", long),
      await file(d, "b.md", long),             // duplicate of a.md
      await file(d, "tiny.txt", "short"),      // < 200 bytes
      await file(d, "pic.png", "x"),           // unsupported
      { kind: "file" as const, path: join(d, "huge.pdf"), size: 60_000_000, mtimeMs: 0 },
      { kind: "repo" as const, path: join(d, "repo") }, // M1: unsupported
    ];
    const r = await prefilter(entries, emptyState, limits);
    expect(r.candidates.map((c) => c.path)).toEqual([join(d, "a.md")]);
    expect(r.candidates[0].duplicates).toEqual([normalizePath(join(d, "b.md"))]);
    expect(r.skippedLarge).toEqual([{ path: join(d, "huge.pdf"), size: 60_000_000 }]);
    expect(r.unsupported).toBe(2);
  });

  it("skips known files and reports changed ones", async () => {
    const d = await tmp();
    const e1 = await file(d, "same.md", "x".repeat(300));
    const e2 = await file(d, "changed.md", "y".repeat(300));
    const state = {
      schema_version: 1 as const, last_scan: null,
      files: {
        [normalizePath(e1.path)]: { source_hash: await sha256File(e1.path), card: "files/a.md", card_body_hash: null, card_snapshot: null, status: "done" as const },
        [normalizePath(e2.path)]: { source_hash: "sha256:old", card: "files/b.md", card_body_hash: null, card_snapshot: null, status: "done" as const },
      },
    };
    const r = await prefilter([e1, e2], state, limits);
    expect(r.candidates).toEqual([]);
    expect(r.changed).toEqual([e2.path]);
  });

  it("retries an analysis_failed entry whose hash is unchanged", async () => {
    const d = await tmp();
    const e = await file(d, "failed.md", "z".repeat(300));
    const hash = await sha256File(e.path);
    const state = {
      schema_version: 1 as const, last_scan: null,
      files: { [normalizePath(e.path)]: { source_hash: hash, card: null, card_body_hash: null, card_snapshot: null, status: "analysis_failed" as const } },
    };
    const r = await prefilter([e], state, limits);
    expect(r.candidates.map((c) => c.path)).toEqual([e.path]);
    expect(r.changed).toEqual([]);
  });

  it("does not retry other non-done statuses with an unchanged hash", async () => {
    const d = await tmp();
    const e = await file(d, "x.md", "w".repeat(300));
    const hash = await sha256File(e.path);
    for (const status of ["extract_failed", "skipped_sensitive", "skipped_long", "duplicate", "skipped_irrelevant"] as const) {
      const state = {
        schema_version: 1 as const, last_scan: null,
        files: {
          [normalizePath(e.path)]: { source_hash: hash, card: null, card_body_hash: null, card_snapshot: null, status },
          // duplicate는 같은 해시의 카드가 남아 있을 때만 건너뛴다
          [normalizePath(join(d, "orig.md"))]: { source_hash: hash, card: "files/orig.md", card_body_hash: null, card_snapshot: null, status: "done" as const },
        },
      };
      expect((await prefilter([e], state, limits)).candidates).toEqual([]);
    }
  });

  it("re-queues skipped_irrelevant entries only with retriage (§9.7 E)", async () => {
    const d = await tmp();
    const e = await file(d, "lecture.md", "v".repeat(300));
    const hash = await sha256File(e.path);
    const state = {
      schema_version: 1 as const, last_scan: null,
      files: { [normalizePath(e.path)]: { source_hash: hash, card: null, card_body_hash: null, card_snapshot: null, status: "skipped_irrelevant" as const } },
    };
    expect((await prefilter([e], state, limits)).candidates).toEqual([]);
    expect((await prefilter([e], state, limits, { retriage: true })).candidates.map((c) => c.path)).toEqual([e.path]);
  });

  it("does not re-send a new copy of a file triage dropped, unless retriage (§9.7 E 같은 해시)", async () => {
    const d = await tmp();
    const a = await file(d, "a.md", "q".repeat(300));
    const b = await file(d, "b.md", "q".repeat(300));
    const hash = await sha256File(a.path);
    const state = {
      schema_version: 1 as const, last_scan: null,
      files: { [normalizePath(a.path)]: { source_hash: hash, card: null, card_body_hash: null, card_snapshot: null, status: "skipped_irrelevant" as const } },
    };
    const r = await prefilter([a, b], state, limits);
    expect(r.candidates).toEqual([]);
    expect(r.knownIrrelevant).toEqual([{ path: b.path, key: normalizePath(b.path), hash }]);
    const r2 = await prefilter([a, b], state, limits, { retriage: true });
    expect(r2.candidates.map((c) => c.path)).toEqual([a.path]);
    expect(r2.knownIrrelevant).toEqual([]);
  });

  it("re-queues a duplicate whose original card entry is gone (R1)", async () => {
    const d = await tmp();
    const a = await file(d, "a.md", "r".repeat(300));
    const b = await file(d, "b.md", "r".repeat(300));
    const hash = await sha256File(a.path);
    const files: Record<string, any> = {
      [normalizePath(a.path)]: { source_hash: hash, card: "files/a.md", card_body_hash: null, card_snapshot: null, status: "done" },
      [normalizePath(b.path)]: { source_hash: hash, card: null, card_body_hash: null, card_snapshot: null, status: "duplicate" },
    };
    const state = { schema_version: 1 as const, last_scan: null, files };
    expect((await prefilter([a, b], state, limits)).candidates).toEqual([]);
    // A의 카드와 state 항목을 지움(원본·카드 삭제) → B가 다시 후보가 된다
    delete files[normalizePath(a.path)];
    const r = await prefilter([b], state, limits);
    expect(r.candidates.map((c) => c.path)).toEqual([b.path]);
    expect(r.knownDuplicates).toEqual([]);
  });

  it("treats a new copy of an already-carded file as a known duplicate", async () => {
    const d = await tmp();
    const a = await file(d, "a.md", "q".repeat(300));
    const b = await file(d, "copy of a.md", "q".repeat(300));
    const state = {
      schema_version: 1 as const, last_scan: null,
      files: { [normalizePath(a.path)]: { source_hash: await sha256File(a.path), card: "files/a.md", card_body_hash: null, card_snapshot: null, status: "done" as const } },
    };
    const r = await prefilter([a, b], state, limits);
    expect(r.candidates).toEqual([]);
    expect(r.knownDuplicates).toEqual([{ path: b.path, key: normalizePath(b.path), hash: await sha256File(b.path), card: "files/a.md" }]);
  });
});
