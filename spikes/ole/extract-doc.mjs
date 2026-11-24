import WordExtractor from 'word-extractor';
import { runAll, docMinimal } from './lib.mjs';
const we = new WordExtractor();
await runAll('doc-word-extractor', ['doc'], async b => (await we.extract(b)).getBody());
await runAll('doc-cfb-min', ['doc'], b => docMinimal(b));
