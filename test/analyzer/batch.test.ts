import { describe, it, expect } from "vitest";
import { makeBatches } from "../../src/analyzer/batch.js";
const item = (id: string, n: number) => ({ id, relPath: id as any, format: "md", modified: "2025-01-01", text: "x".repeat(n) as any });
describe("makeBatches", () => {
  it("packs greedily in order without exceeding the limit", () => {
    const b = makeBatches([item("a", 10_000), item("b", 15_000), item("c", 10_000), item("d", 30_000)], 30_000);
    expect(b.map((x) => x.map((i) => i.id))).toEqual([["a", "b"], ["c"], ["d"]]);
  });
});
