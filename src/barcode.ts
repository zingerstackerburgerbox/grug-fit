/** Barcode decoding engines: native BarcodeDetector when it supports retail formats, otherwise bundled ZXing (offline). */
export type Engine = { name: 'native' | 'zxing' | 'hybrid'; detect: (v: HTMLVideoElement) => Promise<string | null> };
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

async function nativeEngine(): Promise<{ eng: Engine | null; full: boolean }> {
  const BD = (window as any).BarcodeDetector;
  if (!BD || localStorage.getItem('scanEngine') === 'zxing') return { eng: null, full: false };
  try {
    const fmts: string[] = (await BD.getSupportedFormats?.()) || [];
    const ok = RETAIL.filter((f) => fmts.includes(f));
    if (!ok.length) return { eng: null, full: false };
    const det = new BD({ formats: ok });
    return { eng: { name: 'native', detect: async (v) => { const r = await det.detect(v); return r?.[0]?.rawValue || null; } }, full: ok.length === RETAIL.length };
  } catch { return { eng: null, full: false }; }
}

async function zxingEngine(): Promise<Engine> {
  const [{ BrowserMultiFormatOneDReader }, { DecodeHintType, BarcodeFormat }] = await Promise.all([import('@zxing/browser'), import('@zxing/library')]);
  const hints = new Map<any, any>();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  const reader = new BrowserMultiFormatOneDReader(hints);
  const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  let flip = false;
  return {
    name: 'zxing',
    detect: async (v) => {
      const vw = v.videoWidth, vh = v.videoHeight; if (!vw || !vh) return null;
      // alternate between the central viewfinder band and the full frame
      flip = !flip;
      const sw = flip ? vw * 0.9 : vw, sh = flip ? vh * 0.5 : vh, sx = (vw - sw) / 2, sy = (vh - sh) / 2;
      const scale = Math.min(1, 1000 / sw);
      canvas.width = Math.round(sw * scale); canvas.height = Math.round(sh * scale);
      ctx.drawImage(v, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      try { return reader.decodeFromCanvas(canvas).getText(); } catch { return null; }
    }
  };
}

export async function createEngine(): Promise<Engine> {
  const { eng, full } = await nativeEngine();
  if (eng && full) return eng;
  const z = await zxingEngine();
  if (!eng) return z;
  let i = 0; // native supports only some retail formats: alternate both
  return { name: 'hybrid', detect: async (v) => ((i++ % 2 ? await eng.detect(v).catch(() => null) : null) || (await z.detect(v))) };
}
