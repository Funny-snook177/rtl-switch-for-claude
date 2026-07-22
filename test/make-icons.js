/*
 * make-icons.js — تولید آیکون‌های PNG اکستنشن بدون هیچ وابستگی خارجی.
 * یک مربعِ گِردگوشه با رنگ برند و نماد «⇄» (دو فلش تعویض جهت) رسم می‌کند.
 * خروجی: extension/icons/icon16.png, icon48.png, icon128.png
 */
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

function crc32(buf) {
  let c, table = crc32.t;
  if (!table) {
    table = crc32.t = [];
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const body = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(size, pixels) { // pixels: Uint8Array RGBA length size*size*4
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  // raw with filter byte 0 per row
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    pixels.copy ? pixels.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
                : Buffer.from(pixels.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// --- رسم ساده ---
function draw(size) {
  const px = Buffer.alloc(size * size * 4); // RGBA
  const brand = [201, 100, 66, 255];   // #c96442
  const white = [245, 244, 242, 255];
  const radius = Math.round(size * 0.22);

  function set(x, y, c, a) {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    const alpha = (a == null ? c[3] : a) / 255;
    px[i]   = Math.round(c[0] * alpha + px[i]   * (1 - alpha));
    px[i+1] = Math.round(c[1] * alpha + px[i+1] * (1 - alpha));
    px[i+2] = Math.round(c[2] * alpha + px[i+2] * (1 - alpha));
    px[i+3] = 255;
  }
  function inRounded(x, y) {
    const r = radius;
    const cxs = [r, size - 1 - r];
    // گوشه‌ها
    if (x < r && y < r) return (x - r) ** 2 + (y - r) ** 2 <= r * r;
    if (x > size - 1 - r && y < r) return (x - (size - 1 - r)) ** 2 + (y - r) ** 2 <= r * r;
    if (x < r && y > size - 1 - r) return (x - r) ** 2 + (y - (size - 1 - r)) ** 2 <= r * r;
    if (x > size - 1 - r && y > size - 1 - r) return (x - (size - 1 - r)) ** 2 + (y - (size - 1 - r)) ** 2 <= r * r;
    return true;
  }

  // پس‌زمینهٔ برند با گوشهٔ گِرد
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      if (inRounded(x, y)) set(x, y, brand);

  // دو فلش افقی (بالا: راست به چپ، پایین: چپ به راست) => نماد تعویض جهت
  const m = Math.round(size * 0.20);        // حاشیه
  const w = size - 2 * m;                    // پهنای ناحیه فلش
  const th = Math.max(1, Math.round(size * 0.055)); // ضخامت خط
  const head = Math.max(2, Math.round(size * 0.13)); // اندازه سر فلش
  const yTop = Math.round(size * 0.40);
  const yBot = Math.round(size * 0.60);

  function hline(y, x0, x1) {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
      for (let t = -Math.floor(th/2); t <= Math.floor(th/2); t++) set(x, y + t, white);
  }
  function arrowHead(x, y, dir) { // dir=-1 چپ، +1 راست ; رأس در (x,y) — شِوران V شکل
    var half = Math.max(1, Math.floor(th / 2));
    for (let k = 0; k <= head; k++) {
      // دو بازوی اریب که از رأس دور می‌شوند: بالا و پایین
      for (let s = -half; s <= half; s++) {
        set(x + dir * k, y + k + s, white);   // بازوی پایین
        set(x + dir * k, y - k + s, white);   // بازوی بالا
      }
    }
  }
  // فلش بالا: به سمت چپ
  hline(yTop, m, size - m);
  arrowHead(m, yTop, -1);
  // فلش پایین: به سمت راست
  hline(yBot, m, size - m);
  arrowHead(size - m, yBot, +1);

  return px;
}

const outDir = path.join(__dirname, '..', 'extension', 'icons');
fs.mkdirSync(outDir, { recursive: true });
[16, 48, 128].forEach(function (s) {
  const png = encodePNG(s, draw(s));
  fs.writeFileSync(path.join(outDir, 'icon' + s + '.png'), png);
  console.log('wrote icon' + s + '.png (' + png.length + ' bytes)');
});
console.log('done');
