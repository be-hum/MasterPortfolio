import { afterEach, describe, expect, it } from "vitest";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createSetupConfig, pathInputError, SetupError, validateSetup } from "../../src/setup/config.js";
import { mkTmp } from "../helpers/tmp.js";

const dirs: string[] = [];
afterEach(async () => { delete process.env.MP_POINTER_FILE; await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });
const tmp = async () => { const d = await mkTmp("mp-setup-"); dirs.push(d); return d; };

describe("validateSetup", () => {
  it("reports each error", async () => {
    const d = await tmp(); const f = join(d, "file.txt"); await writeFile(f, "x"); const docs = join(d, "docs"); await mkdir(docs);
    const base = { university: "", keywords: [], folders: [docs], planScale: 1, output: join(d, "out") };
    expect(await validateSetup({ ...base, folders: [join(d, "nope")] })).toEqual({ ok: false, errors: [`폴더를 찾을 수 없습니다: ${join(d, "nope")}`, "스캔할 폴더를 하나 이상 고르세요"].slice(0, 1) });
    expect(await validateSetup({ ...base, folders: [f] })).toMatchObject({ ok: false, errors: [`폴더를 찾을 수 없습니다: ${f}`] });
    expect(await validateSetup({ ...base, folders: [] })).toEqual({ ok: false, errors: ["스캔할 폴더를 하나 이상 고르세요"] });
    expect(await validateSetup({ ...base, output: docs })).toEqual({ ok: false, errors: ["결과 폴더는 스캔 폴더와 달라야 합니다"] });
    expect(await validateSetup({ ...base, output: f })).toMatchObject({ ok: false });
    expect(await validateSetup({ ...base, output: "  " })).toMatchObject({ ok: false });
    expect((await validateSetup({ ...base, planScale: 3 }) as { errors: string[] }).errors).toHaveLength(1);
    expect(await validateSetup({ ...base, folders: [`"${docs}"`, docs] })).toEqual({ ok: true, folders: [docs], output: join(d, "out") });
  });
});

describe("createSetupConfig", () => {
  it("creates config, pointer and output folder", async () => {
    const d = await tmp(); const docs = join(d, "docs"); await mkdir(docs);
    process.env.MP_POINTER_FILE = join(d, "p.json");
    const out = join(d, "out", "mp");
    const r = await createSetupConfig({ university: "KAIST", keywords: ["kaist"], folders: [docs], planScale: 5, output: out, agent: "claude" });
    expect(r.output).toBe(out);
    const c = JSON.parse(await readFile(join(out, ".mp", "config.json"), "utf8"));
    expect(c.budget.planScale).toBe(5); expect(c.university.keywords).toEqual(["kaist"]); expect(c.scanFolders).toEqual([docs]);
    expect(JSON.parse(await readFile(join(d, "p.json"), "utf8")).outputDir).toBe(out);
    await expect(createSetupConfig({ university: "", keywords: [], folders: [], planScale: 1, output: out })).rejects.toBeInstanceOf(SetupError);
  });
});

describe("pathInputError (browser path inputs)", () => {
  it("requires a full path in this OS's form", () => {
    expect(pathInputError("결과", "linux")).toMatch(/^전체 경로를 입력하세요/);
    expect(pathInputError("결과", "win32")).toContain("C:\\Users");
    expect(pathInputError("C:\\Users\\me", "linux")).toMatch(/^이 PC에서 쓸 수 없는 경로 형식입니다/);
    expect(pathInputError("/mnt/c/Users", "win32")).toMatch(/^이 PC에서 쓸 수 없는 경로 형식입니다/);
    expect(pathInputError("/home/me/docs", "linux")).toBeNull();
    expect(pathInputError(' "~/docs" ', "linux")).toBeNull();
    expect(pathInputError("", "linux")).toBeNull();
  });

  it("validateSetup rejects a relative output (strict) but mp init (lenient) still accepts it", async () => {
    const d = await tmp(); const docs = join(d, "docs"); await mkdir(docs);
    const v = await validateSetup({ university: "", keywords: [], folders: [docs], planScale: 1, output: "결과" });
    expect(v.ok).toBe(false);
    expect((await validateSetup({ university: "", keywords: [], folders: [docs], planScale: 1, output: "결과" }, { lenient: true })).ok).toBe(true);
  });
});

describe("createSetupConfig never overwrites an existing result folder", () => {
  it("stops with existing; adoptExisting keeps the old config and writes the pointer", async () => {
    const d = await tmp(); const docs = join(d, "docs"); await mkdir(docs);
    process.env.MP_POINTER_FILE = join(d, "p.json");
    const out = join(d, "out");
    await createSetupConfig({ university: "", keywords: [], folders: [docs], planScale: 5, output: out });
    const before = await readFile(join(out, ".mp", "config.json"), "utf8");
    await rm(join(d, "p.json"));
    const e = await createSetupConfig({ university: "", keywords: [], folders: [docs], planScale: 1, output: out }).catch((x) => x);
    expect(e).toBeInstanceOf(SetupError);
    expect(e.existing).toBe(out);
    expect(await readFile(join(out, ".mp", "config.json"), "utf8")).toBe(before);
    const r = await createSetupConfig({ university: "", keywords: [], folders: [], planScale: 1, output: out }, { adoptExisting: true });
    expect(r.config.budget.planScale).toBe(5);
    expect(JSON.parse(await readFile(join(d, "p.json"), "utf8")).outputDir).toBe(out);
    expect(await readFile(join(out, ".mp", "config.json"), "utf8")).toBe(before);
  });
});
