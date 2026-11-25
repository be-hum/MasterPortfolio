import { describe, it, expect } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import JSZip from "jszip";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { extractorFor } from "../../src/extractors/registry.js";
import { CMAP_URL, STANDARD_FONTS_URL } from "../../src/extractors/pdf.js";
import { makeDocx, makePptx } from "../helpers/ooxml.js";
import { mkTmp } from "../helpers/tmp.js";

/** 글꼴을 내장하지 않고 미리 정의된 한글 CMap(UniKS-UCS2-H)을 쓰는 PDF. 한글(HWP)에서 내보낸 PDF에 흔하다 */
function koreanCidPdf(text: string): Buffer {
  const hex = Buffer.from(text, "utf16le").swap16().toString("hex").toUpperCase();
  const content = `BT /F1 12 Tf 40 700 Td <${hex}> Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type0 /BaseFont /HYGoThic-Medium /Encoding /UniKS-UCS2-H /DescendantFonts [6 0 R] >>",
    "<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HYGoThic-Medium /CIDSystemInfo << /Registry (Adobe) /Ordering (Korea1) /Supplement 1 >> /FontDescriptor 7 0 R >>",
    "<< /Type /FontDescriptor /FontName /HYGoThic-Medium /Flags 6 /FontBBox [0 -148 1001 880] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 880 /StemV 93 >>",
  ];
  let out = "%PDF-1.4\n"; const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

describe("extractors", () => {
  it("txt: utf-8", async () => {
    const d = await mkTmp(); const p = join(d, "a.txt");
    await writeFile(p, "캡스톤 디자인 회의록");
    expect(await extractorFor("txt")!.extract(p)).toMatchObject({ ok: true, text: "캡스톤 디자인 회의록" });
  });

  it("txt: CP949 fallback (Review Focus 1)", async () => {
    const d = await mkTmp(); const p = join(d, "a.txt");
    // "한글" in CP949
    await writeFile(p, Buffer.from([0xc7, 0xd1, 0xb1, 0xdb]));
    expect(await extractorFor("txt")!.extract(p)).toMatchObject({ ok: true, text: "한글" });
  });

  it("pdf resource paths use \"/\" and end with it (pdfjs rejects Windows \\ paths)", () => {
    for (const u of [CMAP_URL, STANDARD_FONTS_URL]) { expect(u.endsWith("/")).toBe(true); expect(u).not.toContain("\\"); }
  });

  it("pdf: Korean text with a predefined CMap and no embedded font (HWP export)", async () => {
    const d = await mkTmp(); const p = join(d, "ks.pdf");
    const text = "캡스톤 디자인 보고서: 이미지 분류 서비스 개발과 성능 개선 결과 정리 ".repeat(2);
    await writeFile(p, koreanCidPdf(text));
    const r = await extractorFor("pdf")!.extract(p);
    expect(r.ok && r.text).toContain("캡스톤 디자인 보고서");
  });

  it("docx", async () => {
    const d = await mkTmp(); const p = join(d, "a.docx");
    await writeFile(p, await makeDocx(["첫 문단", "둘째 문단"]));
    const r = await extractorFor("docx")!.extract(p);
    expect(r.ok && r.text).toContain("첫 문단");
    expect(r.ok && r.text).toContain("둘째 문단");
  });

  it("docx: OLE-wrapped (encrypted) file", async () => {
    const d = await mkTmp(); const p = join(d, "enc.docx");
    await writeFile(p, Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(504)]));
    expect(await extractorFor("docx")!.extract(p)).toMatchObject({ ok: false, reason: "encrypted" });
  });

  it("pptx: slides in numeric order", async () => {
    const d = await mkTmp(); const p = join(d, "a.pptx");
    const slides = Array.from({ length: 11 }, (_, i) => `slide-${i + 1}`);
    await writeFile(p, await makePptx(slides));
    const r = await extractorFor("pptx")!.extract(p);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.text.indexOf("slide-2")).toBeLessThan(r.text.indexOf("slide-10"));
      expect(r.meta.pages).toBe(11);
    }
  });

  it("pdf", async () => {
    const d = await mkTmp(); const p = join(d, "a.pdf");
    const doc = await PDFDocument.create(); const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage().drawText("Capstone final report: accuracy improved to 92 percent", { x: 50, y: 700, size: 12, font });
    await writeFile(p, await doc.save());
    const r = await extractorFor("pdf")!.extract(p);
    expect(r.ok && r.text).toContain("Capstone final report");
  });

  it("pdf: image-only page is empty", async () => {
    const d = await mkTmp(); const p = join(d, "scan.pdf");
    const doc = await PDFDocument.create(); doc.addPage();
    await writeFile(p, await doc.save());
    expect(await extractorFor("pdf")!.extract(p)).toMatchObject({ ok: false, reason: "empty" });
  });

  it("missing file yields error, not throw", async () => {
    expect(await extractorFor("pdf")!.extract("/no/such/file.pdf")).toMatchObject({ ok: false });
  });

  it("txt: UTF-16LE with BOM", async () => {
    const d = await mkTmp(); const p = join(d, "a.txt");
    await writeFile(p, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("한글", "utf16le")]));
    expect(await extractorFor("txt")!.extract(p)).toMatchObject({ ok: true, text: "한글" });
  });

  it("txt: undecodable latin-1 is unsupported", async () => {
    const d = await mkTmp(); const p = join(d, "a.txt");
    await writeFile(p, Buffer.from("caf\xe9 cr\xe8me br\xfbl\xe9e na\xefve fa\xe7ade", "latin1"));
    expect(await extractorFor("txt")!.extract(p)).toMatchObject({ ok: false, reason: "unsupported" });
  });

  it("pdf: corrupt file does not throw", async () => {
    const d = await mkTmp(); const p = join(d, "bad.pdf");
    await writeFile(p, "%PDF-1.4 garbage");
    expect(await extractorFor("pdf")!.extract(p)).toMatchObject({ ok: false });
  });

  it("pptx: <a:t> with attributes", async () => {
    const d = await mkTmp(); const p = join(d, "a.pptx");
    const z = new JSZip();
    z.file("ppt/slides/slide1.xml", `<p:sld xmlns:p="p" xmlns:a="a"><a:p><a:r><a:t xml:space="preserve"> 앞뒤 공백 </a:t></a:r></a:p></p:sld>`);
    await writeFile(p, await z.generateAsync({ type: "nodebuffer" }));
    expect(await extractorFor("pptx")!.extract(p)).toMatchObject({ ok: true, text: "앞뒤 공백" });
  });

  it("docx: missing file is error, not corrupted", async () => {
    expect(await extractorFor("docx")!.extract("/no/such/file.docx")).toMatchObject({ ok: false, reason: "error" });
  });

  it("hwpx: sections in numeric order, one line per paragraph, table cells and entities, nothing from other parts", async () => {
    const d = await mkTmp(); const p = join(d, "a.hwpx");
    const z = new JSZip();
    z.file("mimetype", "application/hwp+zip");
    z.file("Contents/header.xml", "<hh:head><hh:fontface>머리-글꼴</hh:fontface></hh:head>");
    const sec = (body: string) => `<?xml version="1.0"?><hs:sec xmlns:hp="x" xmlns:hs="y">${body}</hs:sec>`;
    z.file("Contents/section0.xml", sec(
      `<hp:p id="1"><hp:run><hp:t>졸업 프로젝트 &amp; 보고서</hp:t></hp:run></hp:p>` +
      `<hp:p><hp:run><hp:t>성과:<hp:tab/>정확도 92%</hp:t><hp:t charPrIDRef="3"> 달성</hp:t></hp:run></hp:p>` +
      `<hp:p><hp:run><hp:tbl><hp:tr><hp:tc><hp:subList><hp:p><hp:run><hp:t>표-셀</hp:t></hp:run></hp:p></hp:subList></hp:tc></hp:tr></hp:tbl></hp:run></hp:p>` +
      `<hp:p><hp:run><hp:t/></hp:run></hp:p>`));
    z.file("Contents/section10.xml", sec(`<hp:p><hp:run><hp:t>열번째 구역</hp:t></hp:run></hp:p>`));
    z.file("Contents/section2.xml", sec(`<hp:p><hp:run><hp:t>둘째 구역 &#xAC00;&#44032;</hp:t></hp:run></hp:p>`));
    await writeFile(p, await z.generateAsync({ type: "nodebuffer" }));
    const r = await extractorFor("hwpx")!.extract(p);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).toContain("졸업 프로젝트 & 보고서");
    expect(r.text).toMatch(/성과: +정확도 92% 달성/);
    expect(r.text).toContain("표-셀");
    expect(r.text).toContain("둘째 구역 가가");
    expect(r.text.indexOf("둘째 구역")).toBeLessThan(r.text.indexOf("열번째 구역"));
    expect(r.text).not.toContain("머리-글꼴");
    expect(r.meta.pages).toBe(3);
  });

  it("hwpx: no sections is corrupted, OLE (old HWP renamed or encrypted) is encrypted", async () => {
    const d = await mkTmp();
    const z = new JSZip(); z.file("mimetype", "application/hwp+zip");
    await writeFile(join(d, "e.hwpx"), await z.generateAsync({ type: "nodebuffer" }));
    expect(await extractorFor("hwpx")!.extract(join(d, "e.hwpx"))).toMatchObject({ ok: false, reason: "corrupted" });
    await writeFile(join(d, "o.hwpx"), Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(100)]));
    expect(await extractorFor("hwpx")!.extract(join(d, "o.hwpx"))).toMatchObject({ ok: false, reason: "encrypted" });
    expect(extractorFor("hwp")).toBeNull();
  });
});
