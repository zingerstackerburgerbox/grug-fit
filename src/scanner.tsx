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
  const [zoom, setZoom] = useState<null | { min: number; max: number; step: number; v: number }>(null);
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]); const [camIdx, setCamIdx] = useState(-1); const [focusAt, setFocusAt] = useState<null | [number, number]>(null);
  useEffect(() => {
    if (!open) return;
    let stream: MediaStream | null = null; let stop = false; let t: any;
    setStatus('starting'); setMsg(''); setTorch(null); setManual('');
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setStatus('nocamera'); setMsg('This browser can\'t access the camera (needs HTTPS and a modern browser).'); return; }
      try {
        // higher resolution helps small/curved barcodes; Full HD is the sweet spot for decode speed
        const base: MediaTrackConstraints = { width: { ideal: 1920 }, height: { ideal: 1080 }, ...({ focusMode: { ideal: 'continuous' } } as any) };
        const dev = camIdx >= 0 ? cams[camIdx]?.deviceId : localStorage.getItem('scanCam') || '';
        try { stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: dev ? { ...base, deviceId: { exact: dev } } : { ...base, facingMode: { ideal: 'environment' } } }); }
        catch (e: any) { if (!dev || e?.name === 'NotAllowedError') throw e; localStorage.removeItem('scanCam'); stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { ...base, facingMode: { ideal: 'environment' } } }); }
      } catch (e: any) {
        if (stop) return;
        const n = e?.name || '';
        if (n === 'NotAllowedError' || n === 'SecurityError') { setStatus('denied'); setMsg('Camera permission was denied. To scan, allow camera access: tap the lock/ⓘ icon by the address bar (or Android Settings → Apps → Chrome/Lunk → Permissions → Camera), then try again. You can type the barcode below meanwhile.'); }
        else if (n === 'NotFoundError' || n === 'OverconstrainedError') { setStatus('nocamera'); setMsg('No camera found on this device. Type the barcode number below.'); }
        else { setStatus('error'); setMsg('Couldn\'t start the camera (' + (e?.message || n || 'unknown error') + '). Close other apps using the camera, or type the barcode below.'); }
        return;
      }
      if (stop) { stream.getTracks().forEach((x) => x.stop()); return; }
      const track = stream.getVideoTracks()[0]; trackRef.current = track;
      try {
        const caps: any = track.getCapabilities?.() || {};
        if (caps.torch) setTorch(false);
        if (Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) await track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as any] }).catch(() => {});
        if (caps.zoom && caps.zoom.max > caps.zoom.min) { const st: any = track.getSettings?.() || {}; setZoom({ min: caps.zoom.min, max: Math.min(caps.zoom.max, 8), step: caps.zoom.step || 0.1, v: st.zoom || caps.zoom.min }); } else setZoom(null);
        const all = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
        const back = all.filter((d) => !/front|user|facing front/i.test(d.label)); setCams(back.length ? back : all);
        (window as any).__scanTrack = { label: track.label, settings: track.getSettings?.(), focus: caps.focusMode, zoom: caps.zoom };
      } catch {}
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
          // two matching reads in a row: guards against misreads on curved/angled labels
          if (code === last && ++lastCount >= 1) { stop = true; vibrate([60, 40, 60]); setStatus('found'); setMsg(code); stream?.getTracks().forEach((x) => x.stop()); onCode(code); return; }
          last = code; lastCount = 0;
        }
        t = setTimeout(loop, eng.name === 'native' ? 120 : 60);
      };
      loop();
    })();
    return () => { stop = true; clearTimeout(t); stream?.getTracks().forEach((x) => x.stop()); trackRef.current = null; };
  }, [open, camIdx]);
  if (!open) return null;
  const toggleTorch = async () => { const tr = trackRef.current; if (!tr) return; try { await tr.applyConstraints({ advanced: [{ torch: !torch } as any] }); setTorch(!torch); } catch { setTorch(null); } };
  const camOk = status === 'starting' || status === 'scanning' || status === 'found';
  const setZoomV = async (v: number) => { const tr = trackRef.current; if (!tr || !zoom) return; setZoom({ ...zoom, v }); try { await tr.applyConstraints({ advanced: [{ zoom: v } as any] }); } catch {} };
  // tap to focus (where the camera supports points of interest / single-shot focus), then back to continuous
  const tapFocus = async (e: MouseEvent) => {
    const tr = trackRef.current; if (!tr) return; const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height; setFocusAt([x * 100, y * 100]); setTimeout(() => setFocusAt(null), 900);
    const caps: any = tr.getCapabilities?.() || {}; const modes: string[] = caps.focusMode || [];
    try {
      const adv: any = {}; if ('pointsOfInterest' in caps) adv.pointsOfInterest = [{ x, y }]; if (modes.includes('single-shot')) adv.focusMode = 'single-shot';
      if (Object.keys(adv).length) await tr.applyConstraints({ advanced: [adv] });
      if (modes.includes('continuous')) setTimeout(() => tr.applyConstraints({ advanced: [{ focusMode: 'continuous' } as any] }).catch(() => {}), 1500);
    } catch {}
  };
  const nextCam = () => { if (cams.length < 2) return; const i = ((camIdx < 0 ? Math.max(0, cams.findIndex((c) => c.label === trackRef.current?.label)) : camIdx) + 1) % cams.length; localStorage.setItem('scanCam', cams[i].deviceId); setCamIdx(i); };
  return <div class="scanner" role="dialog" aria-label="Barcode scanner" data-engine={engine} data-status={status}>
    <video ref={vid} muted playsInline class={camOk ? '' : 'hide'} onClick={tapFocus as any} />
    {focusAt && <div class="focus-ring" style={`left:${focusAt[0]}%;top:${focusAt[1]}%`} />}
    {camOk && <div class="vf"><div class="vf-box"><i /><i /><i /><i />{status === 'scanning' && <b class="vf-line" />}</div></div>}
    <div class="sc-top">
      <button class="btn ic sc-btn" onClick={onClose} aria-label="Close scanner">✕</button>
      <div class="grow center b">Scan barcode</div>
      {cams.length > 1 && <button class="btn ic sc-btn" onClick={nextCam} aria-label="Switch camera" title="Switch camera (try another lens if the barcode stays blurry)">🔄</button>}
      {torch != null ? <button class={'btn ic sc-btn ' + (torch ? 'on' : '')} onClick={toggleTorch} aria-label="Toggle torch">{torch ? '🔦' : '💡'}</button> : <span style="width:44px" />}
    </div>
    <div class="sc-bottom">
      <div class="sc-status" role="status">
        {busy ? <>⏳ {busy}</> : status === 'starting' ? 'Starting camera…' : status === 'scanning' ? 'Point the camera at a barcode — it scans automatically' : status === 'found' ? `✅ Found ${msg}` : <span style="color:#fcd34d">{msg}</span>}
      </div>
      {zoom && camOk && <label class="row xs" style="gap:8px;margin-top:6px"><span>Zoom</span><input type="range" aria-label="Zoom" min={zoom.min} max={zoom.max} step={zoom.step} value={zoom.v} onInput={(e) => setZoomV(+e.currentTarget.value)} style="flex:1" /><span>{zoom.v.toFixed(1)}×</span></label>}
      {status === 'scanning' && <div class="xs mut center" style="margin-top:4px">Tip: hold the can 15–25 cm away (zoom in if needed) so the camera can focus; tap the picture to refocus.</div>}
      {status === 'scanning' && <div class="xs mut center" style="margin-top:2px">Decoder: {engine === 'native' ? 'built-in' : engine === 'hybrid' ? 'built-in + ZXing' : 'ZXing (offline)'}</div>}
      <form class="row" style="margin-top:10px" onSubmit={(e) => { e.preventDefault(); const c = manual.trim(); if (c) onCode(c); }}>
        <input inputMode="numeric" placeholder="Or type barcode number" value={manual} onInput={(e) => setManual(e.currentTarget.value.replace(/\D/g, ''))} aria-label="Barcode number" />
        <button class="btn p" type="submit" disabled={manual.length < 6}>Look up</button>
      </form>
      {(status === 'denied' || status === 'error') && <button class="btn full" style="margin-top:8px" onClick={() => { onClose(); setTimeout(() => (document.querySelector('[data-scan-open]') as HTMLElement | null)?.click(), 50); }}>Try camera again</button>}
    </div>
  </div>;
}
