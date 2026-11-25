import { mkdir, readFile } from "node:fs/promises";
import { writeFileAtomic } from "../core/atomicWrite.js";
import { join } from "node:path";
import { Config, DEFAULT_FIVE_HOUR_SHARE, DEFAULT_MODELS } from "../core/schema.js";
import { DEFAULT_AGENTS } from "../agent/agents.js";

export function defaultConfig(p: { university: Config["university"]; scanFolders: string[]; agent: string }): Config {
  return {
    schema_version: 1,
    university: p.university,
    scanFolders: p.scanFolders,
    baselineFolder: null,
    agent: p.agent,
    agents: structuredClone(DEFAULT_AGENTS),
    privacy: { allowPaths: [] },
    limits: {
      maxFileBytes: 52_428_800, minTextBytes: 200, maxFileChars: 30_000, batchChars: 30_000,
      batchTimeoutMs: 300_000, homeDepth: 4, driveDepth: 3,
    },
    models: { ...DEFAULT_MODELS },
    budget: { fiveHourShare: DEFAULT_FIVE_HOUR_SHARE, planScale: 1 },
    scope: { decisions: {} },
    dismissedFolders: [],
  };
}

const configPath = (dir: string) => join(dir, ".mp", "config.json");

export async function loadConfig(outputDir: string): Promise<Config> {
  return Config.parse(JSON.parse(await readFile(configPath(outputDir), "utf8")));
}

export async function saveConfig(outputDir: string, c: Config): Promise<void> {
  await mkdir(join(outputDir, ".mp"), { recursive: true });
  await writeFileAtomic(configPath(outputDir), JSON.stringify(Config.parse(c), null, 2));
}
