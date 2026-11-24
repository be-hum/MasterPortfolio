import { runAll, hwpMinimal } from './lib.mjs';
await runAll('hwp-cfb-min', ['hwp'], b => hwpMinimal(b));
