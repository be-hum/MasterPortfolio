import { describe, it, expect, afterEach, vi } from "vitest";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { mkTmp } from "../helpers/tmp.js";
import { seedCards } from "../helpers/cards.js";
import { runGroup } from "../../src/commands/group.js";
import { runReview } from "../../src/commands/review.js";
import { runMaster } from "../../src/commands/master.js";

describe("group → review → master", () => {
  afterEach(() => { vi.restoreAllMocks(); delete process.env.MP_OUTPUT_DIR; });
  it("produces master.md containing the adopted experience with its STAR", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const out = await mkTmp("mp-out-"); process.env.MP_OUTPUT_DIR = out;
    try {
      await seedCards(out, [{ title: "보고서", period: "2025-03 ~ 2025-06" }, { title: "발표" }], "group-one");
      expect((await runGroup({ yes: true })).created).toHaveLength(1);
      await runReview({ yes: true, io: { show: () => {}, answer: async () => "팀장", decideMany: async (items) => ({ adopted: new Set(items.map((i) => i.rel)), excluded: new Set() }) } });
      const r = await runMaster();
      expect(r.count).toBe(1);
      const md = await readFile(join(out, "master.md"), "utf8");
      expect(md).toContain("### 하나의 경험");
      expect(md).toContain("- Situation: 상황");
      expect(md).toContain("팀장");
      const html = await readFile(join(out, "master.html"), "utf8");
      const data = JSON.parse(html.match(/<script type="application\/json" id="data">([\s\S]*?)<\/script>/)![1]);
      expect(data.experiences.map((e: { title: string }) => e.title)).toEqual(["하나의 경험"]);
      expect(html).toContain('var MODE = "static"');
      expect(r.htmlPath).toBe(join(out, "master.html"));
    } finally { await rm(out, { recursive: true, force: true }); }
  });
});
