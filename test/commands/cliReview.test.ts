import { describe, it, expect } from "vitest";
import { buildProgram } from "../../src/cli.js";

describe("mp review flags", () => {
  it("registers --accept-edits", () => {
    const review = buildProgram().commands.find((c) => c.name() === "review")!;
    expect(review.options.map((o) => o.long)).toContain("--accept-edits");
  });
});
