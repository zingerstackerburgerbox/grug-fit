import { useEffect, useRef, useState } from 'preact/hooks';
import { createEngine, validRetail } from './barcode';
import { vibrate } from './util';

type Status = 'starting' | 'scanning' | 'denied' | 'nocamera' | 'error' | 'found';
/** Full-screen rear-camera barcode scanner with viewfinder, torch toggle and manual entry fallback. */
export function Scanner({ open, onClose, onCode, busy }: { open: boolean; onClose: () => void; onCode: (code: string) => void; busy?: string }) {
  const vid = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<Status>('starting'); const [msg, setMsg] = useState('');
  const [engine, setEngine] = useState(''); const [torch, setTorch] = useState<null | boolean>(null);
  const [manual, setManual] = useState(''); const trackRef = useRef<MediaStreamTrack | null>(null);
  useEffect(() => {
    if (!open) return;
    let stream: MediaStream | null = null; let stop = false; let t: any;
    setStatus('starting'); setMsg(''); setTorch(null); setManual('');
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setStatus('nocamera'); setMsg('This browser can\'t access the camera (needs HTTPS and a modern browser).'); return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
      } catch (e: any) {
        if (stop) return;
        const n = e?.name || '';
        if (n === 'NotAllowedError' || n === 'SecurityError') { setStatus('denied'); setMsg('Camera permission was denied. To scan, allow camera access: tap the lock/ⓘ icon by the address bar (or Android Settings → Apps → Chrome/Grug Fit → Permissions → Camera), then try again. You can type the barcode below meanwhile.'); }
        else if (n === 'NotFoundError' || n === 'OverconstrainedError') { setStatus('nocamera'); setMsg('No camera found on this device. Type the barcode number below.'); }
        else { setStatus('error'); setMsg('Couldn\'t start the camera (' + (e?.message || n || 'unknown error') + '). Close other apps using the camera, or type the barcode below.'); }
        return;
      }
      if (stop) { stream.getTracks().forEach((x) => x.stop()); return; }
      const track = stream.getVideoTracks()[0]; trackRef.current = track;
      try { const caps: any = track.getCapabilities?.(); if (caps?.torch) setTorch(false); } catch {}
      const v = vid.current!; v.srcObject = stream; v.setAttribute('playsinline', ''); await v.play().catch(() => {});
      let eng;
      try { eng = await createEngine(); } catch (e: any) { setStatus('error'); setMsg('Barcode decoder failed to load (' + (e?.message || e) + '). If the app just updated, close and reopen it. You can type the barcode below.'); return; }
      if (stop) return;
      setEngine(eng.name); (window as any).__scanEngine = eng.name; setStatus('scanning');
      let last = ''; let lastCount = 0;
      const loop = async () => {
        if (stop) return;
        let code: string | null = null;
        try { code = await eng.detect(v); } catch {}
        if (code && validRetail(code)) {
          // native detector is very reliable; for ZXing require two matching reads to avoid misreads
          if (eng.name === 'native' || (code === last && ++lastCount >= 1)) { stop = true; vibrate([60, 40, 60]); setStatus('found'); setMsg(code); stream?.getTracks().forEach((x) => x.stop()); onCode(code); return; }
          last = code; lastCount = 0;
        }
        t = setTimeout(loop, eng.name === 'native' ? 120 : 60);
      };
      loop();
    })();
    return () => { stop = true; clearTimeout(t); stream?.getTracks().forEach((x) => x.stop()); trackRef.current = null; };
  }, [open]);
  if (!open) return null;
  const toggleTorch = async () => { const tr = trackRef.current; if (!tr) return; try { await tr.applyConstraints({ advanced: [{ torch: !torch } as any] }); setTorch(!torch); } catch { setTorch(null); } };
  const camOk = status === 'starting' || status === 'scanning' || status === 'found';
  return <div class="scanner" role="dialog" aria-label="Barcode scanner" data-engine={engine} data-status={status}>
    <video ref={vid} muted playsInline class={camOk ? '' : 'hide'} />
    {camOk && <div class="vf"><div class="vf-box"><i /><i /><i /><i />{status === 'scanning' && <b class="vf-line" />}</div></div>}
    <div class="sc-top">
      <button class="btn ic sc-btn" onClick={onClose} aria-label="Close scanner">✕</button>
      <div class="grow center b">Scan barcode</div>
      {torch != null ? <button class={'btn ic sc-btn ' + (torch ? 'on' : '')} onClick={toggleTorch} aria-label="Toggle torch">{torch ? '🔦' : '💡'}</button> : <span style="width:44px" />}
    </div>
    <div class="sc-bottom">
      <div class="sc-status" role="status">
        {busy ? <>⏳ {busy}</> : status === 'starting' ? 'Starting camera…' : status === 'scanning' ? 'Point the camera at a barcode — it scans automatically' : status === 'found' ? `✅ Found ${msg}` : <span style="color:#fcd34d">{msg}</span>}
      </div>
      {status === 'scanning' && <div class="xs mut center" style="margin-top:2px">Decoder: {engine === 'native' ? 'built-in' : engine === 'hybrid' ? 'built-in + ZXing' : 'ZXing (offline)'}</div>}
      <form class="row" style="margin-top:10px" onSubmit={(e) => { e.preventDefault(); const c = manual.trim(); if (c) onCode(c); }}>
        <input inputMode="numeric" placeholder="Or type barcode number" value={manual} onInput={(e) => setManual(e.currentTarget.value.replace(/\D/g, ''))} aria-label="Barcode number" />
        <button class="btn p" type="submit" disabled={manual.length < 6}>Look up</button>
      </form>
      {(status === 'denied' || status === 'error') && <button class="btn full" style="margin-top:8px" onClick={() => { onClose(); setTimeout(() => (document.querySelector('[data-scan-open]') as HTMLElement | null)?.click(), 50); }}>Try camera again</button>}
    </div>
  </div>;
}
