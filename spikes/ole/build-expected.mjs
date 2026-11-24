// Builds samples/expected/<name>.txt (first 2000 normalized chars). Reference sources:
//  gov1-6  : PDF text (pypdf) of the SAME press release posted next to the hwp/hwpx on korea.kr (independent of all candidates)
//  poi-*, tika-* DOC/PPT : Apache POI 5.4.1 (HWPF / HSLF) via java/PoiText.java (independent Java implementation)
//  pyhwp-*, hwpjs-* HWP fixtures : pyhwp-xml (hwp5proc xml) text, cross-checked vs hwp-cfb-min and hwp-hwpjs-deep (see doc)
import fs from 'node:fs';
import { norm } from './score-lib.mjs';
const O = new URL('./out/', import.meta.url).pathname, E = new URL('./samples/expected/', import.meta.url).pathname;
fs.mkdirSync(E, { recursive: true });
const put = (n, t) => fs.writeFileSync(E + n + '.txt', norm(t).slice(0, 2000));
for (let i = 1; i <= 6; i++) if (i !== 2)
  put('gov' + i, fs.readFileSync(`${O}pdf-gov${i}.txt`, 'utf8').split('\n').filter(l => !/^\s*-\s*\d+\s*-\s*$/.test(l)).join('\n'));
// gov2 (distribution doc, table-heavy statistics): PDF text order is unusable (char-bag overlap only 0.55), so use pyhwp-xml; hwp-cfb-min agrees (sim 1.0)
put('gov2', fs.readFileSync(O + 'hwp-pyhwp-xml/gov2.txt', 'utf8'));
// POI leaves Word field instructions (HYPERLINK \"..\") inline; strip them (0x13 code 0x14 result 0x15) so expected = user-visible text
const unfield = t => t.replace(/\x13[^\x14\x15]*(?:\x14|\x15)/g, '').replace(/[\x13\x14\x15]/g, '');
for (const f of fs.readdirSync(O + 'poi')) put(f.replace(/\.txt$/, ''), unfield(fs.readFileSync(O + 'poi/' + f, 'utf8')));
for (const f of fs.readdirSync(O + 'hwp-pyhwp-xml')) {
  if (!/^(pyhwp|hwpjs)-.*\.txt$/.test(f)) continue;
  const t = fs.readFileSync(O + 'hwp-pyhwp-xml/' + f, 'utf8').split('\n').filter(l => !/^\s*<[^>]*>\s*$/.test(l)).join('\n');
  if (norm(t).length) put(f.replace(/\.txt$/, ''), t);
}
