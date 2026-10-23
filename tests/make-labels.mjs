// Renders synthetic nutrition labels (HTML → PNG via Playwright) + degraded "photo-like" variants (sharp).
import { chromium } from 'playwright';
import sharp from 'sharp';
import fs from 'node:fs';
const out = new URL('./labels/', import.meta.url).pathname; fs.mkdirSync(out, { recursive: true });

const auTable = (title, serves, size, unit, rows) => `<div class="au"><h1>NUTRITION INFORMATION</h1>
<p>Servings per package: ${serves}<br>Serving size: ${size}${unit}</p>
<table><tr class="hd"><th></th><th>Avg Quantity<br>per Serving</th><th>Avg Quantity<br>per 100${unit}</th></tr>
${rows.map(([l, a, b, ind]) => `<tr><td style="padding-left:${ind ? 22 : 4}px">${l}</td><td>${a}</td><td>${b}</td></tr>`).join('')}</table></div>`;
const LABELS = {
  'au-muesli': {
    html: auTable('', 15, 45, 'g', [['Energy', '1,640kJ', '1,560kJ'], ['Protein', '4.8g', '10.6g'], ['Fat, total', '3.1g', '6.9g'], ['– saturated', '0.6g', '1.3g', 1], ['Carbohydrate', '27.9g', '62.0g'], ['– sugars', '7.2g', '16.0g', 1], ['Dietary Fibre', '4.1g', '9.1g'], ['Sodium', '14mg', '31mg']].map(([l, a, b, i]) => l === 'Energy' ? [l, '702kJ', b, i] : [l, a, b, i])),
    truth: { style: 'AU', servingSize: 45, servingsPerPack: 15, per100: { kcal: 373, protein: 10.6, fat: 6.9, satfat: 1.3, carbs: 62.0, sugar: 16.0, fibre: 9.1, sodium: 31 } }
  },
  'au-yoghurt': {
    html: auTable('', 5, 170, 'g', [['Energy', '541kJ (129Cal)', '318kJ (76Cal)'], ['Protein', '15.3g', '9.0g'], ['Fat, total', '0.3g', '0.2g'], ['– saturated', '0.2g', '0.1g', 1], ['Carbohydrate', '16.5g', '9.7g'], ['– sugars', '11.7g', '6.9g', 1], ['Sodium', '94mg', '55mg'], ['Calcium', '298mg', '175mg']]),
    truth: { style: 'AU', servingSize: 170, servingsPerPack: 5, per100: { kcal: 76, protein: 9.0, fat: 0.2, satfat: 0.1, carbs: 9.7, sugar: 6.9, sodium: 55, calcium: 175 } }
  },
  'us-granola': {
    html: `<div class="us"><h1>Nutrition Facts</h1><p class="rule">8 servings per container<br><b>Serving size&nbsp;&nbsp;&nbsp;&nbsp;2/3 cup (55g)</b></p>
<p class="amt">Amount per serving</p><p class="cal"><b>Calories</b><b>230</b></p><p class="dv">% Daily Value*</p>
<table>${[['<b>Total Fat</b> 8g', '10%'], ['&nbsp;&nbsp;&nbsp;Saturated Fat 1g', '5%'], ['&nbsp;&nbsp;&nbsp;<i>Trans</i> Fat 0g', ''], ['<b>Cholesterol</b> 0mg', '0%'], ['<b>Sodium</b> 160mg', '7%'], ['<b>Total Carbohydrate</b> 37g', '13%'], ['&nbsp;&nbsp;&nbsp;Dietary Fiber 4g', '14%'], ['&nbsp;&nbsp;&nbsp;Total Sugars 12g', ''], ['<b>Protein</b> 3g', ''], ['Vitamin D 2mcg', '10%'], ['Calcium 260mg', '20%'], ['Iron 8mg', '45%'], ['Potassium 240mg', '6%']].map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</table></div>`,
    // per 100 g derived from the 55 g serving
    truth: { style: 'US', servingSize: 55, servingsPerPack: 8, per100: { kcal: 418, fat: 14.5, satfat: 1.8, sodium: 291, carbs: 67.3, fibre: 7.3, sugar: 21.8, protein: 5.5, calcium: 473, iron: 14.5, potassium: 436 } }
  }
};
const CSS = `body{margin:0;background:#fff;font-family:Helvetica,Arial,sans-serif;color:#000}
.au{width:620px;padding:18px;border:3px solid #000;margin:20px}.au h1{font-size:30px;margin:0 0 8px;text-align:center}.au p{font-size:22px;margin:0 0 10px}
.au table{width:100%;border-collapse:collapse;font-size:22px}.au td,.au th{border-top:2px solid #000;padding:5px 4px;text-align:right}.au td:first-child{text-align:left}.au th{font-size:18px}
.us{width:430px;padding:10px 14px;border:2px solid #000;margin:20px;font-size:20px}.us h1{font-size:48px;margin:0;font-weight:900;letter-spacing:-1px}.us .rule{border-bottom:12px solid #000;margin:4px 0;padding-bottom:6px}
.us .amt{margin:0;font-weight:bold;font-size:16px}.us .cal{display:flex;justify-content:space-between;font-size:38px;margin:0;border-bottom:6px solid #000}.us .dv{text-align:right;margin:2px 0;font-weight:bold;font-size:16px}
.us table{width:100%;border-collapse:collapse}.us td{border-top:1px solid #000;padding:3px 0}.us td:last-child{text-align:right;font-weight:bold}`;

const b = await chromium.launch(); const p = await b.newPage({ deviceScaleFactor: 1 });
const truth = {};
for (const [name, L] of Object.entries(LABELS)) {
  await p.setContent(`<style>${CSS}</style>${L.html}`); const el = await p.$('div');
  const png = await el.screenshot(); fs.writeFileSync(out + name + '.png', png); truth[name] = L.truth;
  const img = sharp(png); const m = await img.metadata();
  // "photo": slight rotation, warm uneven lighting, blur, noise, JPEG, placed on a darker background
  const W = m.width + 160, H = m.height + 160;
  const grad = Buffer.from(`<svg width="${W}" height="${H}"><defs><radialGradient id="g" cx="30%" cy="25%" r="90%"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.38"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`);
  const noise = await sharp({ create: { width: W, height: H, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 22 } } }).png().toBuffer();
  const rot = await sharp(png).rotate(2.5, { background: '#e8e2d2' }).toBuffer(); const rm = await sharp(rot).metadata();
  const photo = await sharp({ create: { width: W, height: H, channels: 3, background: '#6b6157' } })
    .composite([{ input: rot, left: Math.round((W - rm.width) / 2), top: Math.round((H - rm.height) / 2) }, { input: grad }, { input: noise, blend: 'soft-light' }])
    .blur(1.1).tint('#fff3e0').jpeg({ quality: 55 }).toBuffer();
  fs.writeFileSync(out + name + '-photo.jpg', photo); truth[name + '-photo'] = L.truth;
  // "small": low-resolution capture (needs upscaling)
  const small = await sharp(png).resize({ width: Math.round(m.width * 0.5) }).jpeg({ quality: 70 }).toBuffer();
  fs.writeFileSync(out + name + '-small.jpg', small); truth[name + '-small'] = L.truth;
}
fs.writeFileSync(out + 'truth.json', JSON.stringify(truth, null, 1)); await b.close(); console.log('labels written', Object.keys(truth));
