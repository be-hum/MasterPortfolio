import type { Format } from "../scan/prefilter.js";
import type { Extractor } from "./types.js";
import { mdExtractor, txtExtractor } from "./text.js";
import { pdfExtractor } from "./pdf.js";
import { docxExtractor } from "./docx.js";
import { pptxExtractor } from "./pptx.js";

const REGISTRY: Partial<Record<Format, Extractor>> = {
  md: mdExtractor, txt: txtExtractor, pdf: pdfExtractor, docx: docxExtractor, pptx: pptxExtractor,
};
export const extractorFor = (f: Format): Extractor | null => REGISTRY[f] ?? null;
