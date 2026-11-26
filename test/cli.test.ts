import { describe, it, expect } from "vitest";
import { main } from "../src/cli.js";

describe("cli", () => {
  it("prints version and exits 0", async () => {
    const out: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    (process.stdout as any).write = (s: string) => { out.push(String(s)); return true; };
    try {
      expect(await main(["node", "mp", "--version"])).toBe(0);
    } finally { (process.stdout as any).write = orig; }
    expect(out.join("")).toContain("0.3.1");
  });
});
