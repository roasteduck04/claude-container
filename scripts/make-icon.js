// Zero-dependency app-icon generator.
//
// Renders a terracotta squircle with a cream "C" into an RGBA buffer (with
// supersampled anti-aliasing), then encodes it as a PNG by hand using only
// Node's built-in zlib. Also emits a Vista-style ICO that wraps a 256x256
// PNG, so Windows/NSIS has a guaranteed .ico.
//
// No image library, no bundler — matches the project's no-extra-deps ethos.
// Run with: npm run make-icon

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Palette lifted from renderer/style.css (--accent / --text-bright / --rail-bg).
const ACCENT = [0xd9, 0x77, 0x57];      // terracotta
const CREAM = [0xf2, 0xed, 0xe6];       // letter
const BG = [0x1b, 0x1a, 0x19];          // behind the squircle (mostly transparent)

// ---- Rendering ----------------------------------------------------------

// Squircle (superellipse) membership: |x/a|^n + |y/a|^n <= 1, n≈4 gives the
// rounded-square "squircle" look used by the rail badges.
function squircleAlpha(dx, dy, radius, n) {
  const v = Math.pow(Math.abs(dx / radius), n) + Math.pow(Math.abs(dy / radius), n);
  return v <= 1 ? 1 : 0;
}

// A "C": an annulus (ring between innerR and outerR) with the right-hand
// wedge removed. Returns true if the point is part of the glyph.
function inC(dx, dy, innerR, outerR, openHalfAngleDeg) {
  const r = Math.hypot(dx, dy);
  if (r < innerR || r > outerR) return false;
  // angle: 0 = +x (right). Remove a symmetric wedge around the +x axis.
  const ang = Math.atan2(dy, dx) * (180 / Math.PI); // -180..180
  return Math.abs(ang) > openHalfAngleDeg;
}

// Render at `size`, supersampled by `ss`, returns a Buffer of size*size*4 RGBA.
function render(size, ss) {
  const S = size * ss;
  const buf = Buffer.alloc(size * size * 4);

  const cx = S / 2;
  const cy = S / 2;
  const squircleR = S * 0.46;       // squircle "radius"
  const squircleN = 4;
  const outerR = S * 0.30;          // C outer radius
  const innerR = S * 0.17;          // C inner radius
  const openDeg = 42;               // half-angle of the C's mouth

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let rAcc = 0, gAcc = 0, bAcc = 0, aAcc = 0;
      // Supersample this output pixel across an ss x ss grid.
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const px = x * ss + sx + 0.5;
          const py = y * ss + sy + 0.5;
          const dx = px - cx;
          const dy = py - cy;

          const inTile = squircleAlpha(dx, dy, squircleR, squircleN);
          if (!inTile) {
            // fully transparent outside the squircle
            continue;
          }
          if (inC(dx, dy, innerR, outerR, openDeg)) {
            rAcc += CREAM[0]; gAcc += CREAM[1]; bAcc += CREAM[2]; aAcc += 255;
          } else {
            rAcc += ACCENT[0]; gAcc += ACCENT[1]; bAcc += ACCENT[2]; aAcc += 255;
          }
        }
      }
      const n = ss * ss;
      const a = aAcc / n; // coverage-weighted alpha
      const o = (y * size + x) * 4;
      if (a <= 0) {
        buf[o] = BG[0]; buf[o + 1] = BG[1]; buf[o + 2] = BG[2]; buf[o + 3] = 0;
      } else {
        // Colours were only accumulated for covered subsamples, so divide by
        // the covered count (aAcc/255), not n, to avoid darkening edges.
        const covered = aAcc / 255;
        buf[o] = Math.round(rAcc / covered);
        buf[o + 1] = Math.round(gAcc / covered);
        buf[o + 2] = Math.round(bAcc / covered);
        buf[o + 3] = Math.round(a);
      }
    }
  }
  return buf;
}

// ---- PNG encoding -------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(rgba, size) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);   // width
  ihdr.writeUInt32BE(size, 4);   // height
  ihdr[8] = 8;                   // bit depth
  ihdr[9] = 6;                   // colour type: RGBA
  ihdr[10] = 0;                  // compression
  ihdr[11] = 0;                  // filter
  ihdr[12] = 0;                  // interlace

  // Add the mandatory per-scanline filter byte (0 = None).
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- ICO encoding (single PNG-compressed image) -------------------------

function encodeIco(pngBuf, size) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);   // reserved
  header.writeUInt16LE(1, 2);   // type: icon
  header.writeUInt16LE(1, 4);   // image count

  const entry = Buffer.alloc(16);
  entry[0] = size >= 256 ? 0 : size; // width (0 means 256)
  entry[1] = size >= 256 ? 0 : size; // height (0 means 256)
  entry[2] = 0;                      // palette
  entry[3] = 0;                      // reserved
  entry.writeUInt16LE(1, 4);         // colour planes
  entry.writeUInt16LE(32, 6);        // bits per pixel
  entry.writeUInt32LE(pngBuf.length, 8);  // image size
  entry.writeUInt32LE(6 + 16, 12);        // offset to image data

  return Buffer.concat([header, entry, pngBuf]);
}

// ---- Main ---------------------------------------------------------------

const assetsDir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(assetsDir, { recursive: true });

// 512px PNG for the window/taskbar icon + electron-builder (mac/linux).
const png512 = encodePng(render(512, 4), 512);
fs.writeFileSync(path.join(assetsDir, 'icon.png'), png512);

// 256px PNG wrapped in an ICO for Windows/NSIS.
const png256 = encodePng(render(256, 4), 256);
fs.writeFileSync(path.join(assetsDir, 'icon.ico'), encodeIco(png256, 256));

console.log('Wrote assets/icon.png (512x512) and assets/icon.ico (256x256).');
