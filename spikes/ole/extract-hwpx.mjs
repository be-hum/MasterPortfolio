import { runAll, hwpxText } from './lib.mjs';
await runAll('hwpx-jszip', ['hwpx'], b => hwpxText(b));
