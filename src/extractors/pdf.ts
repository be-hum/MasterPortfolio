import { readFile } from "node:fs/promises";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { normalizeWhitespace } from "../core/text.js";
import { errResult, type Extractor } from "./types.js";

export const pdfExtractor: Extractor = {
  id: "pdf",
  async extract(path) {
    let task: ReturnType<typeof getDocument> | undefined;
    try {
      const buf = await readFile(path);
      const data = new Uint8Array(buf.buffer, buf.byteOffset, buf.length);
      // pdfjs 6.x has no eval code paths, so the old `isEvalSupported` option no longer exists.
      task = getDocument({ data, useSystemFonts: true, verbosity: 0 });
      const doc = await task.promise;
      const pages: string[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const tc = await page.getTextContent();
        page.cleanup();
        pages.push(tc.items.map((it: any) => ("str" in it ? it.str : "")).join(" "));
      }
      const text = normalizeWhitespace(pages.join("\n\n"));
      if (doc.numPages === 0 || text.length / doc.numPages < 20) return { ok: false, reason: "empty", detail: "텍스트 없는 PDF(스캔본 추정)" };
      return { ok: true, text, meta: { pages: doc.numPages } };
    } catch (e: any) {
      if (e?.name === "PasswordException") return { ok: false, reason: "encrypted" };
      if (e?.name === "InvalidPDFException") return { ok: false, reason: "corrupted", detail: e.message };
      return errResult(e);
    } finally {
      // 정리 실패가 추출 결과(또는 스캔 전체)를 깨뜨리지 않게 한다
      try { await task?.destroy(); } catch { /* 무시 */ }
    }
  },
};
