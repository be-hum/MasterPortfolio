import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import CFB from 'cfb';
import JSZip from 'jszip';

export const SAMPLES = new URL('./samples/', import.meta.url).pathname;
export const OUT = new URL('./out/', import.meta.url).pathname;

export function listSamples(exts) {
  const r = [];
  for (const d of fs.readdirSync(SAMPLES)) {
    const dir = path.join(SAMPLES, d);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir)) {
      const e = path.extname(f).slice(1).toLowerCase();
      if (exts.includes(e)) r.push({ name: path.basename(f, '.' + e), ext: e, file: path.join(dir, f) });
    }
  }
  return r.sort((a, b) => a.name.localeCompare(b.name));
}

export function writeOut(cand, name, text) {
  const d = path.join(OUT, cand);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, name + '.txt'), text);
}

// Run `fn(buf)` for every sample, catch errors, write out/<cand>/<name>.txt (or .err)
export async function runAll(cand, exts, fn) {
  for (const s of listSamples(exts)) {
    const t0 = performance.now();
    try {
      const text = await fn(fs.readFileSync(s.file), s);
      writeOut(cand, s.name, text);
      console.log(cand, s.name, 'ok', text.length, 'chars', Math.round(performance.now() - t0) + 'ms');
    } catch (e) {
      writeOut(cand, s.name + '.ERR', String(e && e.message || e));
      console.log(cand, s.name, 'FAIL', String(e && e.message || e).slice(0, 100));
    }
  }
}

// ---------- HWP 5.0 minimal parser (cfb + inflateRaw) ----------
export const HWPTAG_PARA_TEXT = 0x10 + 51; // 67

export function* records(buf) {
  let p = 0;
  while (p + 4 <= buf.length) {
    const h = buf.readUInt32LE(p); p += 4;
    const tag = h & 0x3ff, level = (h >> 10) & 0x3ff;
    let size = h >>> 20;
    if (size === 0xfff) { size = buf.readUInt32LE(p); p += 4; }
    yield { tag, level, data: buf.subarray(p, p + size) };
    p += size;
  }
}

// Decode PARA_TEXT payload. Control chars < 32: char-type (0,10,13,24-31) take 1 WCHAR,
// inline (4-9,19,20) and extended (1-3,11,12,14-18,21-23) take 8 WCHARs (16 bytes).
export function decodeParaText(d) {
  let out = '';
  for (let i = 0; i + 1 < d.length;) {
    const c = d.readUInt16LE(i);
    if (c >= 32) { out += String.fromCharCode(c); i += 2; continue; }
    if (c === 9) { out += '\t'; i += 16; continue; }
    if (c === 10) { out += '\n'; i += 2; continue; }
    if (c === 13) { i += 2; continue; }
    if (c === 0 || (c >= 24 && c <= 31)) { if (c === 30 || c === 31) out += ' '; i += 2; continue; }
    i += 16; // inline / extended control: skip 14 bytes of payload + closing code
  }
  return out;
}

export function hwpMinimal(buf) {
  const cfb = CFB.parse(buf);
  const fh = CFB.find(cfb, 'FileHeader');
  if (!fh) throw new Error('no FileHeader stream (not HWP 5.0)');
  const hd = Buffer.from(fh.content);
  const sig = hd.subarray(0, 17).toString('latin1');
  if (!sig.startsWith('HWP Document File')) throw new Error('bad signature ' + sig);
  const flags = hd.readUInt32LE(36);
  const compressed = !!(flags & 1), encrypted = !!(flags & 2), distribution = !!(flags & 4);
  if (encrypted) throw new Error('password-encrypted document (FileHeader flag bit1)');
  const dir = distribution ? 'ViewText' : 'BodyText';
  const secs = cfb.FullPaths.map((p, i) => ({ p, i }))
    .filter(x => new RegExp('^Root Entry/' + dir + '/Section\\d+$').test(x.p))
    .sort((a, b) => parseInt(a.p.match(/\d+$/)[0]) - parseInt(b.p.match(/\d+$/)[0]));
  if (!secs.length) throw new Error('no BodyText sections');
  let text = '';
  for (const s of secs) {
    let data = Buffer.from(cfb.FileIndex[s.i].content);
    if (distribution) data = decryptDistribution(data);
    if (compressed) data = zlib.inflateRawSync(data);
    for (const r of records(data)) if (r.tag === HWPTAG_PARA_TEXT) text += decodeParaText(r.data) + '\n';
  }
  return text;
}

// Distribution (배포용) docs: ViewText/SectionN = [record hdr 4B][256B DISTRIBUTE_DOC_DATA][AES-128-ECB(tail)]
function decryptDistribution(stream) {
  const hdr = stream.readUInt32LE(0);
  if ((hdr & 0x3ff) !== 0x10 + 12) throw new Error('first ViewText record is not HWPTAG_DISTRIBUTE_DOC_DATA');
  const data = Buffer.from(stream.subarray(4, 4 + 256));
  let seed = data.readUInt32LE(0);
  const rand = () => { seed = (Math.imul(seed, 214013) + 2531011) >>> 0; return (seed >>> 16) & 0x7fff; };
  let n = 0, key = 0;
  for (let i = 0; i < 256; i++) {
    if (n === 0) { key = rand() & 0xff; n = (rand() & 0xf) + 1; }
    if (i >= 4) data[i] ^= key;
    n--;
  }
  const off = 4 + (data.readUInt32LE(0) & 0xf);
  const aesKey = data.subarray(off, off + 16);
  const tail = stream.subarray(4 + 256);
  const d = crypto.createDecipheriv('aes-128-ecb', aesKey, null); d.setAutoPadding(false);
  return Buffer.concat([d.update(tail.subarray(0, tail.length - (tail.length % 16))), d.final()]);
}

// ---------- HWPX ----------
export async function hwpxText(buf) {
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files).filter(n => /^Contents\/section\d+\.xml$/i.test(n))
    .sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));
  if (!names.length) throw new Error('no Contents/section*.xml');
  const mf = zip.file('META-INF/manifest.xml');
  if (mf && (await mf.async('string')).includes('encryption-data')) throw new Error('encrypted/distribution HWPX (odf:encryption-data in META-INF/manifest.xml, AES-256-CBC)');
  let out = '';
  for (const n of names) {
    const xml = await zip.file(n).async('string');
    // paragraph boundaries -> newline; <hp:t> content (with inline <hp:tab/>, <hp:lineBreak/>) -> text
    for (const pm of xml.matchAll(/<hp:p\b[^>]*>([\s\S]*?)<\/hp:p>/g)) {
      let line = '';
      for (const m of pm[1].matchAll(/<hp:t(?:\s[^>]*)?>([\s\S]*?)<\/hp:t>|<hp:t\s*\/>|<hp:(tab|lineBreak)\b[^>]*\/>/g)) {
        if (m[2] === 'tab') line += '\t'; else if (m[2] === 'lineBreak') line += '\n';
        else if (m[1] !== undefined) line += m[1].replace(/<[^>]+>/g, '');
      }
      out += unesc(line) + '\n';
    }
  }
  return out;
}
const unesc = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&amp;/g, '&');

// ---------- DOC minimal piece-table parser ----------
export function docMinimal(buf) {
  const cfb = CFB.parse(buf);
  const wd = CFB.find(cfb, 'WordDocument');
  if (!wd) throw new Error('no WordDocument stream');
  const w = Buffer.from(wd.content);
  if (w.readUInt16LE(0) !== 0xa5ec) throw new Error('bad wIdent 0x' + w.readUInt16LE(0).toString(16) + ' (Word 6/95 or not Word)');
  const flags = w.readUInt16LE(0x0a);
  if (flags & 0x0100) throw new Error('encrypted DOC');
  const tblName = flags & 0x0200 ? '1Table' : '0Table';
  const tbl = Buffer.from(CFB.find(cfb, tblName).content);
  const ccpText = w.readInt32LE(76), ccpFtn = w.readInt32LE(80), ccpHdd = w.readInt32LE(84);
  const fcClx = w.readUInt32LE(0x1a2), lcbClx = w.readUInt32LE(0x1a6);
  let p = fcClx;
  const end = fcClx + lcbClx;
  while (tbl[p] === 1) p += 3 + tbl.readUInt16LE(p + 1); // Prc
  if (tbl[p] !== 2) throw new Error('no Pcdt in CLX');
  const lcb = tbl.readUInt32LE(p + 1); p += 5;
  const n = (lcb - 4) / 12;
  const cps = []; for (let i = 0; i <= n; i++) cps.push(tbl.readUInt32LE(p + i * 4));
  const pcd = p + (n + 1) * 4;
  const limit = ccpText; // main document only (footnotes/headers/textboxes follow in CP space)
  let out = '';
  for (let i = 0; i < n; i++) {
    const fcRaw = tbl.readUInt32LE(pcd + i * 8 + 2);
    const compressed = !!(fcRaw & 0x40000000);
    const fc = fcRaw & 0x3fffffff;
    const a = cps[i], b = Math.min(cps[i + 1], limit);
    if (a >= limit) break;
    const len = b - a;
    out += compressed
      ? w.subarray(fc / 2, fc / 2 + len).toString('latin1') // really CP1252
      : w.subarray(fc, fc + len * 2).toString('utf16le');
  }
  return cleanDoc(out);
}
function cleanDoc(s) {
  // field codes: 0x13 begin, 0x14 separator, 0x15 end -> keep display part only
  let out = '', depth = 0, inCode = [];
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c === 0x13) { inCode.push(true); continue; }
    if (c === 0x14) { if (inCode.length) inCode[inCode.length - 1] = false; continue; }
    if (c === 0x15) { inCode.pop(); continue; }
    if (inCode.includes(true)) continue;
    if (c === 0x0d || c === 0x07) out += '\n';
    else if (c === 0x0b) out += '\n';
    else if (c === 0x0c || c === 0x01 || c === 0x08) continue;
    else out += ch;
  }
  return out;
}

// ---------- PPT minimal parser ----------
// mode 'naive': every TextCharsAtom/TextBytesAtom anywhere (includes masters, notes, duplicates)
// mode 'slides': only atoms inside Slide containers (0x03EE; free text boxes) and SlideListWithText instance 0 (0x0FF0; placeholder text); skips masters (SLWT inst 1, MainMaster 0x03F8) and notes (SLWT inst 2, 0x03F0)
export function pptMinimal(buf, mode = 'slides') {
  const cfb = CFB.parse(buf);
  const st = CFB.find(cfb, 'PowerPoint Document');
  if (!st) throw new Error('no "PowerPoint Document" stream');
  const d = Buffer.from(st.content);
  let out = '';
  const walk = (s, e, inSlide, inSlwt = false) => {
    let p = s;
    while (p + 8 <= e) {
      const verInst = d.readUInt16LE(p), type = d.readUInt16LE(p + 2), len = d.readUInt32LE(p + 4);
      const ver = verInst & 0xf;
      const body = p + 8, bend = Math.min(body + len, e);
      if (ver === 0xf) walk(body, bend, inSlide || type === 0x03ee, inSlwt || (type === 0x0ff0 && (verInst >> 4) === 0));
      else if (mode === 'naive' || inSlide || inSlwt) {
        if (type === 0x0fa0) out += d.subarray(body, bend).toString('utf16le').replace(/[\r\v]/g, '\n') + '\n';
        else if (type === 0x0fa8) out += d.subarray(body, bend).toString('latin1').replace(/[\r\v]/g, '\n') + '\n';
      }
      p = bend;
    }
  };
  if (mode === 'live') {
    // Incremental saves leave stale copies of slides in the stream. Follow Current User -> UserEditAtom chain,
    // merge persist directories (newest wins) and only walk top-level records at live persist offsets.
    const cu = CFB.find(cfb, 'Current User');
    const live = new Map(); // persistId -> offset
    let edit = Buffer.from(cu.content).readUInt32LE(16);
    const seen = new Set();
    while (edit && !seen.has(edit) && edit + 8 + 28 <= d.length) {
      seen.add(edit);
      if (d.readUInt16LE(edit + 2) !== 0x0ff5) break;
      const prev = d.readUInt32LE(edit + 8 + 8), dirOff = d.readUInt32LE(edit + 8 + 12);
      if (d.readUInt16LE(dirOff + 2) === 0x1772) {
        const end = dirOff + 8 + d.readUInt32LE(dirOff + 4);
        for (let q = dirOff + 8; q < end;) {
          const v = d.readUInt32LE(q); q += 4;
          const id = v & 0xfffff, cnt = v >>> 20;
          for (let k = 0; k < cnt; k++, q += 4) if (!live.has(id + k)) live.set(id + k, d.readUInt32LE(q));
        }
      }
      edit = prev;
    }
    for (const off of [...new Set(live.values())].sort((a, b) => a - b)) {
      if (off + 8 > d.length) continue;
      const verInst = d.readUInt16LE(off), type = d.readUInt16LE(off + 2), len = d.readUInt32LE(off + 4);
      if (verInst & 0xf) walk(off + 8, Math.min(off + 8 + len, d.length), type === 0x03ee);
    }
    return out;
  }
  walk(0, d.length, false);
  return out;
}
