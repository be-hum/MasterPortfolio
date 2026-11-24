import { readFile } from "node:fs/promises";
import { normalizeWhitespace } from "../core/text.js";
import { errResult, type Extractor } from "./types.js";

export function decodeText(buf: Buffer): string | null {
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf.subarray(2));
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder("utf-16be").decode(buf.subarray(2));
  const b = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? buf.subarray(3) : buf;
  try { return new TextDecoder("utf-8", { fatal: true }).decode(b); }
  catch {
    const t = new TextDecoder("euc-kr").decode(b);
    const bad = [...t].filter((c) => c === "\uFFFD").length;
    return bad / Math.max(1, [...t].length) > 0.01 ? null : t;
  }
}

const make = (id: "md" | "txt"): Extractor => ({
  id,
  async extract(path) {
    try {
      const decoded = decodeText(await readFile(path));
      if (decoded === null) return { ok: false, reason: "unsupported", detail: "알 수 없는 텍스트 인코딩" };
      const text = normalizeWhitespace(decoded);
      return text ? { ok: true, text, meta: {} } : { ok: false, reason: "empty" };
    } catch (e) { return errResult(e); }
  },
});
export const mdExtractor = make("md");
export const txtExtractor = make("txt");
