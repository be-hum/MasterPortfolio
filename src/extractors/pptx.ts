import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { normalizeWhitespace } from "../core/text.js";
import { isOle, type Extractor } from "./types.js";

const decodeXml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const texts = (xml: string) => [...xml.matchAll(/<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>/g)].map((m) => decodeXml(m[1]));
const num = (name: string) => Number(name.match(/(\d+)\.xml$/)?.[1] ?? 0);

export const pptxExtractor: Extractor = {
  id: "pptx",
  async extract(path) {
    try {
      const buf = await readFile(path);
      if (isOle(buf)) return { ok: false, reason: "encrypted" };
      const zip = await JSZip.loadAsync(buf);
      const slides = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => num(a) - num(b));
      const parts: string[] = [];
      for (const s of slides) {
        parts.push(texts(await zip.file(s)!.async("string")).join(" "));
        const note = zip.file(`ppt/notesSlides/notesSlide${num(s)}.xml`);
        if (note) parts.push(texts(await note.async("string")).join(" "));
      }
      const text = normalizeWhitespace(parts.join("\n\n"));
      return text ? { ok: true, text, meta: { pages: slides.length } } : { ok: false, reason: "empty" };
    } catch (e) { return { ok: false, reason: "corrupted", detail: e instanceof Error ? e.message : String(e) }; }
  },
};
