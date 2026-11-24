import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, sep } from "node:path";
import { normalizeWhitespace } from "../core/text.js";
import { errResult, type Extractor } from "./types.js";

type Pdfjs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

/** pdfjs 자원 폴더. CJK 문서의 미리 정의된 CMap(예: UniKS-UCS2-H)과 표준 글꼴이 없으면 한글이 빈 텍스트로 나온다 */
const PDFJS_DIR = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
const CMAP_URL = join(PDFJS_DIR, "cmaps") + sep;
const STANDARD_FONTS_URL = join(PDFJS_DIR, "standard_fonts") + sep;

let pdfjs: Promise<Pdfjs> | null = null;
/**
 * pdfjs는 Node에서 불러올 때 렌더링용 선택 의존성(@napi-rs/canvas)이 없으면 경고를 찍는다.
 * 텍스트 추출에는 필요 없어서 배포본에서 빼므로, 불러오는 동안 그 경고만 거른다.
 */
function loadPdfjs(): Promise<Pdfjs> {
  return (pdfjs ??= (async () => {
    const log = console.log, warn = console.warn;
    const quiet = (f: (...a: unknown[]) => void) => (...a: unknown[]) => {
      if (typeof a[0] === "string" && /Cannot (load "@napi-rs\/canvas"|polyfill)/.test(a[0])) return;
      f(...a);
    };
    console.log = quiet(log); console.warn = quiet(warn);
    try { return await import("pdfjs-dist/legacy/build/pdf.mjs"); }
    finally { console.log = log; console.warn = warn; }
  })());
}

export const pdfExtractor: Extractor = {
  id: "pdf",
  async extract(path) {
    let task: ReturnType<Pdfjs["getDocument"]> | undefined;
    try {
      const { getDocument } = await loadPdfjs();
      const buf = await readFile(path);
      const data = new Uint8Array(buf.buffer, buf.byteOffset, buf.length);
      // pdfjs 6.x has no eval code paths, so the old `isEvalSupported` option no longer exists.
      task = getDocument({ data, useSystemFonts: true, verbosity: 0, cMapUrl: CMAP_URL, cMapPacked: true, standardFontDataUrl: STANDARD_FONTS_URL });
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
