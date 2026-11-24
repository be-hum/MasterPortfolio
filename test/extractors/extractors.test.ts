import { describe, it, expect } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import JSZip from "jszip";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { extractorFor } from "../../src/extractors/registry.js";
import { makeDocx, makePptx } from "../helpers/ooxml.js";
import { mkTmp } from "../helpers/tmp.js";

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
});
