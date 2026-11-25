import { afterEach, describe, expect, it } from "vitest";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { checkEnvironment } from "../../src/setup/check.js";
import { saveConfig, defaultConfig } from "../../src/config/config.js";
import { mkTmp } from "../helpers/tmp.js";

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });

describe("checkEnvironment", () => {
  it("reports missing setup", async () => {
    const items = await checkEnvironment(null, { skipAgent: true });
    expect(items).toContainEqual({ ok: false, label: "설정 없음", fix: "`mp init`을 실행하세요" });
  });
  it("reports ok items for output and scan folders", async () => {
    const d = await mkTmp("mp-chk-"); dirs.push(d);
    const docs = join(d, "docs"); await mkdir(docs);
    await saveConfig(d, defaultConfig({ university: { input: "", keywords: [] }, scanFolders: [docs], agent: "claude" }));
    const items = await checkEnvironment(d, { skipAgent: true });
    expect(items).toContainEqual({ ok: true, label: `결과 폴더 쓰기 가능: ${d}` });
    expect(items).toContainEqual({ ok: true, label: `읽기 가능: ${docs}` });
    expect(items.some((i) => i.label.startsWith("에이전트"))).toBe(false);
  });
});
