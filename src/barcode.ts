/** Barcode decoding engines: native BarcodeDetector when it supports retail formats, otherwise bundled ZXing (offline). */
export type Engine = { name: 'native' | 'zxing' | 'hybrid'; detect: (v: any) => Promise<string | null> };
const RETAIL = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];

export function validRetail(code: string): boolean {
  if (!/^\d+$/.test(code)) return false;
  if (code.length === 8 || code.length === 12 || code.length === 13 || code.length === 14) {
    if (code.length === 8 && /^[01]/.test(code)) return true; // UPC-E (checksum needs expansion) – trust decoder
    const d = code.split('').map(Number); const check = d.pop()!;
    const sum = d.reverse().reduce((a, x, i) => a + x * (i % 2 === 0 ? 3 : 1), 0);
    return (10 - (sum % 10)) % 10 === check;
  }
  return false;
}

/** Anything we can draw: a live <video>, or a canvas/image in tests. */
export type Frame = (HTMLVideoElement | HTMLCanvasElement | HTMLImageElement) & { videoWidth?: number; videoHeight?: number };
const dims = (v: Frame) => [(v as any).videoWidth || (v as any).naturalWidth || v.width, (v as any).videoHeight || (v as any).naturalHeight || v.height] as const;

async function nativeEngine(): Promise<{ eng: Engine | null; full: boolean }> {
  const BD = (window as any).BarcodeDetector;
  if (!BD || localStorage.getItem('scanEngine') === 'zxing') return { eng: null, full: false };
  try {
    const fmts: string[] = (await BD.getSupportedFormats?.()) || [];
    const ok = RETAIL.filter((f) => fmts.includes(f)); // must include ean_13 for AU products
    if (!ok.length) return { eng: null, full: false };
    const det = new BD({ formats: ok });
    return { eng: { name: 'native', detect: async (v) => { const r = await det.detect(v); return r?.find((x: any) => validRetail(x.rawValue))?.rawValue || null; } }, full: ok.includes('ean_13') && ok.includes('upc_a') };
  } catch { return { eng: null, full: false }; }
}

/** Decode attempts cycled frame by frame: crop of the frame (fraction w×h, centred), target width (up- or down-scaled), rotation.
 *  Small barcodes need upscaling (ZXing misses bars only ~1.5 px wide); barcodes held vertically need a 90° pass. */
export const PLANS: { w: number; h: number; tw: number; rot: 0 | 90; sharp?: boolean }[] = [
  { w: 0.9, h: 0.45, tw: 1280, rot: 0 }, // viewfinder band
  { w: 1, h: 1, tw: 1280, rot: 0 }, // whole frame
  { w: 0.6, h: 0.3, tw: 1280, rot: 0 }, // tight centre, ~2× upscale
  { w: 0.45, h: 0.9, tw: 1280, rot: 90 }, // vertical band, rotated
  { w: 1, h: 1, tw: 960, rot: 90 }, // whole frame, rotated
  { w: 0.3, h: 0.6, tw: 1280, rot: 90 }, // tight centre, rotated + upscaled
  { w: 0.8, h: 0.4, tw: 1280, rot: 0, sharp: true }, // slightly out of focus: unsharp mask
  { w: 0.6, h: 0.3, tw: 1280, rot: 0, sharp: true }
];
const tmp = document.createElement('canvas');
/** unsharp mask on luminance: out = I + 2.5·(I − blur(I)); rescues slightly defocused close-ups */
function unsharp(c: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
  const w = c.width, h = c.height; tmp.width = w; tmp.height = h; const t = tmp.getContext('2d', { willReadFrequently: true })!;
  t.filter = `blur(${Math.max(2, Math.round(w / 400))}px)`; t.drawImage(c, 0, 0); t.filter = 'none';
  const a = ctx.getImageData(0, 0, w, h), bl = t.getImageData(0, 0, w, h).data, d = a.data;
  for (let i = 0; i < d.length; i += 4) { const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; const yb = 0.299 * bl[i] + 0.587 * bl[i + 1] + 0.114 * bl[i + 2]; const o = Math.max(0, Math.min(255, y + 2.5 * (y - yb))); d[i] = d[i + 1] = d[i + 2] = o; }
  ctx.putImageData(a, 0, 0);
}
async function zxingEngine(): Promise<Engine & { decodePlan: (v: Frame, i: number) => string | null }> {
  const [{ BrowserMultiFormatOneDReader }, { DecodeHintType, BarcodeFormat }] = await Promise.all([import('@zxing/browser'), import('@zxing/library')]);
  const hints = new Map<any, any>();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  const reader = new BrowserMultiFormatOneDReader(hints);
  const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  let n = 0;
  const decodePlan = (v: Frame, i: number) => {
    const [vw, vh] = dims(v); if (!vw || !vh) return null;
    const P = PLANS[i % PLANS.length];
    const sw = vw * P.w, sh = vh * P.h, sx = (vw - sw) / 2, sy = (vh - sh) / 2;
    const along = P.rot ? sh : sw; const k = Math.min(3, Math.max(0.25, P.tw / along));
    const cw = Math.round(sw * k), ch = Math.round(sh * k);
    if (P.rot) { canvas.width = ch; canvas.height = cw; ctx.setTransform(0, 1, -1, 0, ch, 0); } else { canvas.width = cw; canvas.height = ch; ctx.setTransform(1, 0, 0, 1, 0, 0); }
    ctx.imageSmoothingQuality = 'high'; ctx.drawImage(v as any, sx, sy, sw, sh, 0, 0, cw, ch); ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (P.sharp) unsharp(canvas, ctx);
    try { return reader.decodeFromCanvas(canvas).getText(); } catch { return null; }
  };
  return { name: 'zxing', decodePlan, detect: async (v) => decodePlan(v, n++) };
}

export async function createEngine(): Promise<Engine> {
  const { eng, full } = await nativeEngine();
  const z = await zxingEngine();
  if (!eng) return z;
  // native first; every 3rd frame (every frame if native lacks EAN-13/UPC-A) also try ZXing's multi-scale/rotated passes as a backup
  let i = 0;
  return { name: full ? 'native' : 'hybrid', detect: async (v) => (await eng.detect(v).catch(() => null)) || (!full || ++i % 3 === 0 ? await z.detect(v) : null) };
}
/** test hook: ZXing with an explicit plan index */
export const zxingForTest = zxingEngine;
