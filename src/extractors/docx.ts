import { readFile } from "node:fs/promises";
import mammoth from "mammoth";
import { normalizeWhitespace } from "../core/text.js";
import { errResult, isOle, type Extractor } from "./types.js";

export const docxExtractor: Extractor = {
  id: "docx",
  async extract(path) {
    let buffer: Buffer;
    try { buffer = await readFile(path); } catch (e) { return errResult(e); }
    try {
      if (isOle(buffer)) return { ok: false, reason: "encrypted" };
      const { value } = await mammoth.extractRawText({ buffer });
      const text = normalizeWhitespace(value);
      return text ? { ok: true, text, meta: {} } : { ok: false, reason: "empty" };
    } catch (e) { return { ok: false, reason: "corrupted", detail: e instanceof Error ? e.message : String(e) }; }
  },
};
