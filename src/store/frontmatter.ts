import YAML from "yaml";

export function stringifyCard(fm: object, body: string): string {
  return `---\n${YAML.stringify(fm, { lineWidth: 0 })}---\n${body}`;
}

export function parseCard(text: string): { fm: Record<string, unknown>; body: string } {
  const m = text.replace(/^﻿/, "").match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { fm: {}, body: text };
  return { fm: (YAML.parse(m[1]) ?? {}) as Record<string, unknown>, body: m[2] };
}
