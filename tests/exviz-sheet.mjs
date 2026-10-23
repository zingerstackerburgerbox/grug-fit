// Renders a contact sheet of every built-in exercise visual (start pose + end pose) → screenshots/exercise-icons-sheet.png
import { chromium } from 'playwright';
import { buildSync } from 'esbuild';
import fs from 'fs';
const out = buildSync({ entryPoints: ['src/exviz/defs.ts'], bundle: true, format: 'iife', globalName: 'EX', write: false, footer: { js: '' } });
const rig = buildSync({ entryPoints: ['src/exviz/rig.ts'], bundle: true, format: 'iife', globalName: 'RIG', write: false });
const seed = buildSync({ entryPoints: ['src/seed.ts'], bundle: true, format: 'iife', globalName: 'SEED', write: false });
const only = process.argv[2];
const html = `<html><body style="margin:0;background:#0f1115;color:#e8eaed;font:11px system-ui"><div style="padding:8px 10px;font-size:14px">Grug Fit exercise visuals — left: thumbnail as shown in lists (start pose, cropped) · right: end of the movement (animated in app) · orange = main muscles</div><div id=g style="display:grid;grid-template-columns:repeat(${only === 'generic' ? 14 : only ? 4 : 8},1fr);gap:6px;padding:8px"></div>
<script>${out.outputFiles[0].text}${rig.outputFiles[0].text}${seed.outputFiles[0].text}
const g=document.getElementById('g'); const only=${JSON.stringify(only || '')};
if (only === 'generic') { for (const m of EX.GENERIC_MUSCLES) for (const q of ['Barbell','Dumbbell','Cable','Machine','Kettlebell','Band','Bodyweight']) { const c=document.createElement('div'); c.style.cssText='background:#171a21;border-radius:8px;padding:4px;text-align:center'; c.innerHTML=RIG.renderSvg(EX.genericDef(m,q),EX.genericDef(m,q).thumb||0,{size:110,fit:true})+'<div>'+m+' / '+q+'</div>'; g.appendChild(c); } }
const R = only.startsWith('r') ? only.slice(1).split('-').map(Number) : null;
if (only !== 'generic') SEED.SEED_EXERCISES.forEach((e, i) => { if (R ? (i < R[0] || i > R[1]) : (only && !e.name.toLowerCase().includes(only.toLowerCase()))) return; const d = EX.DEFS[e.name]; const c=document.createElement('div'); c.style.cssText='background:#171a21;border-radius:8px;padding:4px;text-align:center';
  c.innerHTML = d ? '<div style="display:flex">'+RIG.renderSvg(d,d.thumb||0,{size:${only ? 220 : 92},fit:true})+RIG.renderSvg(d,0.5,{size:${only ? 220 : 92}})+'</div><div>'+e.name+'</div>' : '<div style="height:92px;color:#f87171">MISSING</div>'+e.name; g.appendChild(c); });
</script></body></html>`;
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: only ? 1900 : 1700, height: 800 } });
p.on('pageerror', (e) => console.log('ERR', e.message));
await p.setContent(html); await p.screenshot({ path: only ? '/tmp/sheet-' + only.replace(/\W/g, '') + '.png' : 'screenshots/exercise-icons-sheet.png', fullPage: true });
const missing = await p.$$eval('div', (l) => l.filter((x) => x.textContent.startsWith('MISSING')).length); console.log('missing', missing);
await b.close();
