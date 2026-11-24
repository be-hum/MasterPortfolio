import { createRequire } from 'node:module';
import { runAll } from './lib.mjs';
const require = createRequire(import.meta.url);
const { parse } = require('hwp.js');
// "naive" = only top-level paragraph chars (what the README-level API gives)
// "deep"  = also recurse into control.content (tables -> rows -> cells.items -> paragraphs, text boxes)
function walker(deep) {
  let out = '';
  const para = p => {
    for (const c of p.content ?? []) if (typeof c.value === 'string') out += c.value;
    out += '\n';
    if (deep) for (const c of p.controls ?? []) node(c.content);
  };
  const node = n => {
    if (!n) return;
    if (Array.isArray(n)) return n.forEach(node);
    if (n.items) return n.items.forEach(para);          // table cell
    if (n.content && Array.isArray(n.content) && n.content.some(c => 'value' in c)) return para(n); // paragraph
  };
  return { run(doc) { for (const s of doc.sections) for (const p of s.content) para(p); return out; } };
}
const parseDoc = b => parse(b, { type: 'buffer' });
await runAll('hwp-hwpjs', ['hwp'], b => walker(false).run(parseDoc(b)));
await runAll('hwp-hwpjs-deep', ['hwp'], b => walker(true).run(parseDoc(b)));
