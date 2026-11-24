// usage: node score.mjs  -> prints markdown tables of per-sample scores for every out/<candidate>/ dir
import fs from 'node:fs';
import { norm, similarity } from './score-lib.mjs';
const O = new URL('./out/', import.meta.url).pathname, E = new URL('./samples/expected/', import.meta.url).pathname;
const exts = { 'hwp-': 'HWP', 'hwpx-': 'HWPX', 'doc-': 'DOC', 'ppt-': 'PPT' };
const rows = {};
for (const c of fs.readdirSync(O)) {
  const fmt = Object.entries(exts).find(([p]) => c.startsWith(p))?.[1]; if (!fmt) continue;
  for (const e of fs.readdirSync(E)) {
    const n = e.replace(/\.txt$/, '');
    const f = `${O}${c}/${n}.txt`, errf = `${O}${c}/${n}.ERR.txt`;
    const exp = fs.readFileSync(E + e, 'utf8');
    let s;
    if (fs.existsSync(f)) s = similarity(exp, norm(fs.readFileSync(f, 'utf8')));
    else if (fs.existsSync(errf)) s = 0; else continue;
    ((rows[fmt] ??= {})[n] ??= {})[c] = s;
  }
}
for (const [fmt, byName] of Object.entries(rows)) {
  const cands = [...new Set(Object.values(byName).flatMap(r => Object.keys(r)))].sort();
  console.log(`\n### ${fmt}\n| sample | ${cands.join(' | ')} |\n|---|${cands.map(() => '---').join('|')}|`);
  const sums = Object.fromEntries(cands.map(c => [c, [0, 0]]));
  for (const [n, r] of Object.entries(byName).sort()) {
    console.log(`| ${n} | ${cands.map(c => { if (r[c] === undefined) return '-'; sums[c][0] += r[c]; sums[c][1]++; return r[c].toFixed(3); }).join(' | ')} |`);
  }
  console.log(`| **mean** | ${cands.map(c => (sums[c][0] / sums[c][1]).toFixed(3) + ` (n=${sums[c][1]})`).join(' | ')} |`);
}
