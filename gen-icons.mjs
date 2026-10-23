import sharp from 'sharp';
const svg = (pad) => `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#22c55e"/><stop offset="1" stop-color="#0ea5e9"/></linearGradient></defs>
<rect width="512" height="512" rx="${pad?0:110}" fill="#0f1115"/>
<g transform="translate(256 256) scale(${pad?0.72:1}) translate(-256 -256)">
<circle cx="256" cy="256" r="190" fill="none" stroke="url(#g)" stroke-width="34"/>
<rect x="136" y="236" width="240" height="40" rx="12" fill="#fff"/>
<rect x="116" y="186" width="44" height="140" rx="14" fill="#fff"/>
<rect x="352" y="186" width="44" height="140" rx="14" fill="#fff"/>
<rect x="164" y="206" width="28" height="100" rx="10" fill="#e5e7eb"/>
<rect x="320" y="206" width="28" height="100" rx="10" fill="#e5e7eb"/>
</g></svg>`;
await sharp(Buffer.from(svg(false))).resize(512).png().toFile('public/icon-512.png');
await sharp(Buffer.from(svg(false))).resize(192).png().toFile('public/icon-192.png');
await sharp(Buffer.from(svg(true))).resize(512).png().toFile('public/icon-maskable-512.png');
await sharp(Buffer.from(svg(true))).resize(180).png().toFile('public/apple-touch-icon.png');
