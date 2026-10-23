// Generates a fake camera feed (Y4M) showing an EAN-13 barcode, for Chrome's --use-file-for-fake-video-capture
import bwipjs from 'bwip-js';
import sharp from 'sharp';
import fs from 'fs';
const code = process.argv[2] || '3017620422003'; const out = process.argv[3] || 'tests/barcode.y4m';
const W = 640, H = 480;
const png = await bwipjs.toBuffer({ bcid: 'ean13', text: code, scale: 3, height: 22, includetext: true, backgroundcolor: 'FFFFFF', paddingwidth: 12, paddingheight: 8 });
const bc = await sharp(png).resize({ width: 420 }).toBuffer();
const frame = await sharp({ create: { width: W, height: H, channels: 3, background: { r: 120, g: 110, b: 100 } } })
  .composite([{ input: bc, gravity: 'center' }]).greyscale().raw().toBuffer({ resolveWithObject: true });
const Y = frame.data.length === W * H ? frame.data : Buffer.from(frame.data.filter((_, i) => i % frame.info.channels === 0));
const UV = Buffer.alloc((W / 2) * (H / 2), 128);
const parts = [Buffer.from(`YUV4MPEG2 W${W} H${H} F10:1 Ip A1:1 C420jpeg\n`)];
for (let i = 0; i < 10; i++) parts.push(Buffer.from('FRAME\n'), Y, UV, UV);
fs.writeFileSync(out, Buffer.concat(parts));
await sharp(Y, { raw: { width: W, height: H, channels: 1 } }).png().toFile(out.replace('.y4m', '.png'));
console.log('wrote', out, code);
