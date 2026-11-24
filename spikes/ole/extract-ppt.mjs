import { runAll, pptMinimal } from './lib.mjs';
await runAll('ppt-cfb-naive', ['ppt'], b => pptMinimal(b, 'naive'));
await runAll('ppt-cfb-slides', ['ppt'], b => pptMinimal(b, 'slides'));
await runAll('ppt-cfb-live', ['ppt'], b => pptMinimal(b, 'live'));
