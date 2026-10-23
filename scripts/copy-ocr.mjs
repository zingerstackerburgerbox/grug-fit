// Copies Tesseract.js worker, WASM cores and English traineddata into public/tesseract so OCR runs fully on-device / offline.
import fs from 'fs';
const out = 'public/tesseract'; fs.mkdirSync(out + '/lang', { recursive: true });
const cp = (a, b) => { fs.copyFileSync(a, b); };
cp('node_modules/tesseract.js/dist/worker.min.js', `${out}/worker.min.js`);
const core = 'node_modules/tesseract.js-core';
for (const f of fs.readdirSync(core)) if (/^tesseract-core.*lstm\.wasm\.js$/.test(f)) cp(`${core}/${f}`, `${out}/${f}`);
cp('node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', `${out}/lang/eng.traineddata.gz`);
console.log('OCR assets copied:', fs.readdirSync(out).join(', '));
