// Frame strips: renders each matching exercise at 10 evenly spaced points through its loop (start → end → start).
// usage: node tests/exviz-strip.mjs "<name substring>[|<another>...]" out.png [frames=10] [title]
import { chromium } from 'playwright';
import { buildSync } from 'esbuild';
const b1 = buildSync({ stdin: { contents: "export * from './src/exviz/rig'; export { DEFS } from './src/exviz/defs';", resolveDir: '.', loader: 'ts' }, bundle: true, format: 'iife', globalName: 'EX', write: false }).outputFiles[0].text;
const [pat = '', outFile = '/tmp/strip.png', nf = '10', title = ''] = process.argv.slice(2);
const pats = pat.toLowerCase().split('|');
const html = `<html><body style="margin:0;background:#0f1115;color:#e8eaed;font:12px system-ui;padding:8px">${title ? `<div style="font-size:15px;margin-bottom:6px">${title}</div>` : ''}<div id=g></div><script>${b1}
const N=${+nf}; const g=document.getElementById('g');
for (const [n,d] of Object.entries(EX.DEFS)) { if (!${JSON.stringify(pats)}.some(p=>n.toLowerCase().includes(p))) continue;
  const r=document.createElement('div'); r.style.cssText='margin:4px 0 10px'; let h='<div style="margin:2px 0">'+n+'</div><div style="display:flex;gap:4px">';
  for (let i=0;i<N;i++){ const p=i/N; h+='<div style="background:#171a21;border-radius:6px;text-align:center">'+EX.renderSvg(d,p,{size:${process.env.SZ || 132}})+'<div style="color:#8b93a1;font-size:10px">'+p.toFixed(2)+'</div></div>'; }
  r.innerHTML=h+'</div>'; g.appendChild(r); }
</script></body></html>`;
const br = await chromium.launch(); const pg = await br.newPage({ viewport: { width: 1400, height: 400 } });
pg.on('pageerror', (e) => console.log('ERR', e.message));
await pg.setContent(html); await pg.screenshot({ path: outFile, fullPage: true }); await br.close(); console.log('wrote', outFile);
