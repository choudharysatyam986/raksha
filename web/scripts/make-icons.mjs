// Generates the PNG app icons (no image libraries needed). Run: node web/scripts/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/icons');
mkdirSync(out, { recursive: true });

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};

/** Shield half-width at normalised y (0..1), or -1 outside the shield. */
function shield(y, s) {
  const top = 0.5 - 0.32 * s, mid = 0.5 + 0.02 * s, tip = 0.5 + 0.34 * s, hw = 0.27 * s;
  if (y < top || y > tip) return -1;
  if (y <= mid) return hw;
  return hw * Math.sqrt((tip - y) / (tip - mid));
}

function inHeart(x, y, s) {
  const hx = (x - 0.5) / (0.12 * s), hy = -(y - 0.48) / (0.12 * s);
  return Math.pow(hx * hx + hy * hy - 1, 3) - hx * hx * hy * hy * hy <= 0;
}

function render(size, maskable) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(size * stride);
  const s = maskable ? 0.75 : 1;
  const SS = 3;
  for (let py = 0; py < size; py++) {
    raw[py * stride] = 0;
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const x = (px + (sx + 0.5) / SS) / size, y = (py + (sy + 0.5) / SS) / size;
        const rad = maskable ? 0 : 0.22;
        const dx = Math.max(rad - x, 0, x - (1 - rad)), dy = Math.max(rad - y, 0, y - (1 - rad));
        if (!(maskable || dx * dx + dy * dy <= rad * rad)) continue;
        let c = [Math.round(124 - 33 * y), Math.round(58 - 25 * y), Math.round(237 - 55 * y)];
        const hw = shield(y, s);
        if (hw >= 0 && Math.abs(x - 0.5) <= hw) c = inHeart(x, y, s) ? [219, 39, 119] : [255, 255, 255];
        r += c[0]; g += c[1]; b += c[2]; a += 255;
      }
      const n = SS * SS, o = py * stride + 1 + px * 4;
      const cov = a / 255 || 1;
      raw[o] = Math.round(r / cov); raw[o + 1] = Math.round(g / cov); raw[o + 2] = Math.round(b / cov); raw[o + 3] = Math.round(a / n);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

for (const [name, size, mask] of [['icon-192.png', 192, false], ['icon-512.png', 512, false], ['maskable-512.png', 512, true], ['badge-96.png', 96, false]]) {
  writeFileSync(path.join(out, name), render(size, mask));
  console.log('wrote', name);
}
