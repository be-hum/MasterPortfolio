export function normalizeWhitespace(s: string): string {
  return s.replace(/\r\n?/g, "\n").replace(/[ \t\f\v ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
