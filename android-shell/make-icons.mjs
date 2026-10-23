// Launcher icons for the Android shell from the PWA's maskable icon (run: node android-shell/make-icons.mjs).
import sharp from 'sharp'; import { writeFileSync } from 'node:fs';
const src = 'public/icon-maskable-512.png'; const R = 'android/app/src/main/res';
const D = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const { data } = await sharp(src).resize(1, 1).raw().toBuffer({ resolveWithObject: true }); // corner/background colour
const bg = '#' + [...(await sharp(src).extract({ left: 2, top: 2, width: 1, height: 1 }).raw().toBuffer())].slice(0, 3).map((x) => x.toString(16).padStart(2, '0')).join('');
for (const [d, f] of Object.entries(D)) {
  const s = Math.round(48 * f), fg = Math.round(108 * f);
  await sharp(src).resize(s, s).png().toFile(`${R}/mipmap-${d}/ic_launcher.png`);
  const r = Math.round(s / 2); const mask = Buffer.from(`<svg width="${s}" height="${s}"><circle cx="${r}" cy="${r}" r="${r}"/></svg>`);
  await sharp(src).resize(s, s).composite([{ input: mask, blend: 'dest-in' }]).png().toFile(`${R}/mipmap-${d}/ic_launcher_round.png`);
  // adaptive foreground: maskable icons keep content in the inner 80 %; adaptive shows the inner 72/108 → scale to fill
  await sharp(src).resize(fg, fg).png().toFile(`${R}/mipmap-${d}/ic_launcher_foreground.png`);
}
writeFileSync(`${R}/values/ic_launcher_background.xml`, `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${bg}</color>\n</resources>\n`);
console.log('icons ok, background', bg, data.length);
