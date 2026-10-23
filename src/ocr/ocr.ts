/** On-device OCR (Tesseract.js, lazy-loaded, assets served locally from /tesseract/). */
import { createWorker, type Worker } from 'tesseract.js';
import { parseLabel, type OcrLine, type Parsed } from './parse';

export type Crop = { x: number; y: number; w: number; h: number }; // normalised 0..1
let workerP: Promise<Worker> | null = null; let progressCb: ((p: number, status: string) => void) | null = null;
const base = () => new URL('tesseract/', document.baseURI).href;

export function getWorker() {
  if (!workerP) workerP = (async () => {
    const w = await createWorker('eng', 1, {
      workerPath: base() + 'worker.min.js', corePath: base(), langPath: base() + 'lang', workerBlobURL: false,
      cacheMethod: 'none', // the service worker caches /tesseract/* (CacheFirst) so this works offline after first use
      logger: (m: any) => progressCb?.(m.progress ?? 0, m.status || '')
    });
    await w.setParameters({ tessedit_pageseg_mode: '6' as any, preserve_interword_spaces: '1', user_defined_dpi: '300' });
    return w;
  })().catch((e) => { workerP = null; throw e; });
  return workerP;
}

export async function loadBitmap(file: Blob) {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' } as any); } catch { return await createImageBitmap(file); }
}

/** Crop → scale (upscale small text, downscale huge photos) → grayscale → contrast stretch → optional adaptive threshold. */
export function preprocess(src: ImageBitmap | HTMLCanvasElement, crop: Crop, mode: 'gray' | 'binary'): HTMLCanvasElement {
  const sw = src.width * crop.w, sh = src.height * crop.h; const sx = src.width * crop.x, sy = src.height * crop.y;
  const target = Math.min(2400, Math.max(1600, sw)); const scale = target / sw;
  const W = Math.round(sw * scale), H = Math.round(sh * scale);
  const c = document.createElement('canvas'); c.width = W; c.height = H; const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high'; ctx.drawImage(src as any, sx, sy, sw, sh, 0, 0, W, H);
  const img = ctx.getImageData(0, 0, W, H); const d = img.data; const g = new Uint8ClampedArray(W * H);
  const hist = new Uint32Array(256);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) { const v = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000; g[j] = v; hist[g[j]]++; }
  // contrast stretch between 2nd and 98th percentile
  let lo = 0, hi = 255, acc = 0; const n = W * H;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > n * 0.02) { lo = v; break; } }
  acc = 0; for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > n * 0.02) { hi = v; break; } }
  const span = Math.max(1, hi - lo);
  for (let j = 0; j < n; j++) g[j] = ((g[j] - lo) * 255) / span;
  // dark-background labels (white text): invert so text is dark
  let mean = 0; for (let j = 0; j < n; j += 7) mean += g[j]; mean /= n / 7; if (mean < 110) for (let j = 0; j < n; j++) g[j] = 255 - g[j];
  if (mode === 'binary') { // Bradley adaptive threshold via integral image – copes with shadows / uneven light
    const S = Math.max(15, Math.round(W / 40)) | 1, T = 0.12; const ii = new Float64Array((W + 1) * (H + 1));
    for (let y = 1; y <= H; y++) { let row = 0; for (let x = 1; x <= W; x++) { row += g[(y - 1) * W + x - 1]; ii[y * (W + 1) + x] = ii[(y - 1) * (W + 1) + x] + row; } }
    const out = new Uint8ClampedArray(n); const h2 = S >> 1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const x1 = Math.max(0, x - h2), x2 = Math.min(W - 1, x + h2), y1 = Math.max(0, y - h2), y2 = Math.min(H - 1, y + h2);
      const cnt = (x2 - x1 + 1) * (y2 - y1 + 1);
      const sum = ii[(y2 + 1) * (W + 1) + x2 + 1] - ii[y1 * (W + 1) + x2 + 1] - ii[(y2 + 1) * (W + 1) + x1] + ii[y1 * (W + 1) + x1];
      out[y * W + x] = g[y * W + x] * cnt < sum * (1 - T) ? 0 : 255;
    }
    g.set(out);
  }
  for (let i = 0, j = 0; i < d.length; i += 4, j++) { d[i] = d[i + 1] = d[i + 2] = g[j]; d[i + 3] = 255; }
  ctx.putImageData(img, 0, 0); return c;
}

async function recognise(c: HTMLCanvasElement): Promise<{ lines: OcrLine[]; text: string; conf: number }> {
  const w = await getWorker();
  const { data } = await w.recognize(c, {}, { blocks: true, text: true } as any);
  const lines: OcrLine[] = [];
  for (const b of data.blocks || []) for (const p of b.paragraphs) for (const l of p.lines) {
    const numWords = l.words.filter((x) => /\d/.test(x.text));
    const conf = Math.min(l.confidence, ...numWords.map((x) => x.confidence));
    lines.push({ text: l.text.replace(/\s+$/, ''), conf: isFinite(conf) ? conf : l.confidence });
  }
  return { lines, text: data.text, conf: data.confidence };
}
const score = (p: Parsed) => Object.keys(p.per100).length * 2 + Object.keys(p.perServing).length - p.flagged.length * 2 + (p.servingSize ? 2 : 0);

export type OcrResult = { parsed: Parsed; text: string; lines: OcrLine[]; pass: 'gray' | 'binary'; ms: number };
/** Two-pass OCR: grayscale first; if the result looks incomplete, retry with adaptive threshold and keep the better parse. */
export async function readLabel(src: ImageBitmap | HTMLCanvasElement, crop: Crop, onProgress?: (p: number, status: string) => void): Promise<OcrResult> {
  const t0 = performance.now();
  progressCb = (p, s) => onProgress?.(p * 0.5, s);
  const a = await recognise(preprocess(src, crop, 'gray')); const pa = parseLabel(a.lines);
  let best: OcrResult = { parsed: pa, text: a.text, lines: a.lines, pass: 'gray', ms: 0 };
  const core = ['kcal', 'protein', 'fat', 'carbs'].filter((k) => (pa.per100 as any)[k] != null).length;
  if (core < 4 || pa.flagged.length) {
    progressCb = (p, s) => onProgress?.(0.5 + p * 0.5, s + ' (2nd pass)');
    const b = await recognise(preprocess(src, crop, 'binary')); const pb = parseLabel(b.lines);
    if (score(pb) > score(pa)) best = { parsed: pb, text: b.text, lines: b.lines, pass: 'binary', ms: 0 };
  }
  progressCb = null; best.ms = Math.round(performance.now() - t0); onProgress?.(1, 'done');
  return best;
}
/** Download + initialise the OCR engine once so the service worker caches it (label scanning then works offline). */
export async function prefetchOcr() { await getWorker(); }
