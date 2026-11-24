export const norm = s => s.normalize('NFC').replace(/[\s\u0000-\u001f ​﻿]+/g, '');
export function lev(a, b) {
  const n = a.length, m = b.length;
  let prev = new Int32Array(m + 1), cur = new Int32Array(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    cur[0] = i;
    for (let j = 1; j <= m; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1));
    }
    [prev, cur] = [cur, prev];
  }
  return prev[m];
}
export const similarity = (exp, got) => {
  const a = exp.slice(0, 2000), b = got.slice(0, 2000);
  const L = Math.max(a.length, b.length);
  return L === 0 ? 1 : 1 - lev(a, b) / L;
};
