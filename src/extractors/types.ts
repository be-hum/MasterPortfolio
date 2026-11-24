import type { Format } from "../scan/prefilter.js";
export type ExtractResult =
  | { ok: true; text: string; meta: { pages?: number; title?: string } }
  | { ok: false; reason: "encrypted" | "corrupted" | "unsupported" | "empty" | "error"; detail?: string };
export interface Extractor { id: Format; extract(path: string): Promise<ExtractResult>; }

export const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
export const isOle = (b: Buffer) => b.length >= 8 && b.subarray(0, 8).equals(OLE_MAGIC);
export const errResult = (e: unknown): ExtractResult => ({ ok: false, reason: "error", detail: e instanceof Error ? e.message : String(e) });
