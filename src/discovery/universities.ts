import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export type University = { name: string; aliases: string[]; en: string; abbr: string[] };

export function loadUniversities(): University[] {
  const here = dirname(fileURLToPath(import.meta.url));
  // src/discovery 또는 dist/discovery 기준 ../../data
  return JSON.parse(readFileSync(join(here, "..", "..", "data", "universities.json"), "utf8"));
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
const shortKo = (s: string) => s.replace(/대학교$/, "대");

const FIRST_WORD_STOP = new Set(
  ("university college institute national seoul korea korean catholic dong kyung gwangju daegu busan incheon " +
    "daejeon ulsan jeonju cheju jeju suwon christian methodist presbyterian global international open cyber " +
    "science technology pohang").split(" "),
);

function expansionOf(u: University): string[] {
  const first = u.en.split(/\s+/)[0] ?? "";
  const useFirst = first.length > 0 && !/^university of\b/i.test(u.en) && !FIRST_WORD_STOP.has(first.toLowerCase());
  return [u.name, ...u.aliases, u.en, ...(useFirst ? [first] : []), ...u.abbr];
}

export function expandUniversity(rawInput: string, dict: University[] = loadUniversities()): string[] {
  const input = rawInput.trim();
  if (input.length === 0) return [];
  const q = norm(input);
  const hits = dict.filter((u) =>
    [u.name, ...u.aliases, u.en, ...u.abbr].filter(Boolean).some((v) => norm(v) === q),
  );
  const out = hits.length > 0 ? hits.flatMap(expansionOf) : [input, shortKo(input)];
  return [...new Set(out.filter((s) => s.length > 0))];
}
