import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { normalizeWhitespace } from "../core/text.js";
import { isOle, type Extractor } from "./types.js";

/**
 * HWPX(한글 2014+ 기본 저장 형식, OWPML): zip 안의 Contents/section0.xml, section1.xml …에 본문이 있다.
 * 글자는 <hp:t> 요소에, 문단 끝은 </hp:p>. 표 안 문단도 같은 순서로 나온다.
 * (옛 바이너리 HWP(.hwp)는 지원하지 않는다: 위치만 보고서에 남김)
 */
const decodeXml = (s: string) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** 섹션 XML → 문단마다 한 줄. <hp:t> 안의 탭·줄바꿈 같은 하위 요소는 공백으로 */
export function hwpxSectionText(xml: string): string {
  const out: string[] = [];
  let line = "";
  const re = /<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>|<\/(?:\w+:)?p>/g;
  for (const m of xml.matchAll(re)) {
    if (m[1] !== undefined) line += decodeXml(m[1].replace(/<[^>]*>/g, " "));
    else { if (line.trim()) out.push(line); line = ""; }
  }
  if (line.trim()) out.push(line);
  return out.join("\n");
}

const num = (name: string) => Number(name.match(/section(\d+)\.xml$/i)?.[1] ?? 0);

export const hwpxExtractor: Extractor = {
  id: "hwpx",
  async extract(path) {
    try {
      const buf = await readFile(path);
      if (isOle(buf)) return { ok: false, reason: "encrypted" };
      const zip = await JSZip.loadAsync(buf);
      const sections = Object.keys(zip.files).filter((n) => /^Contents\/section\d+\.xml$/i.test(n)).sort((a, b) => num(a) - num(b));
      if (!sections.length) return { ok: false, reason: "corrupted", detail: "본문(Contents/section*.xml)이 없습니다" };
      const parts: string[] = [];
      for (const s of sections) parts.push(hwpxSectionText(await zip.file(s)!.async("string")));
      const text = normalizeWhitespace(parts.join("\n\n"));
      return text ? { ok: true, text, meta: { pages: sections.length } } : { ok: false, reason: "empty" };
    } catch (e) { return { ok: false, reason: "corrupted", detail: e instanceof Error ? e.message : String(e) }; }
  },
};
