// pcx.ts — ZSoft PCX (.pcx) decode + encode, pure & node-safe. PCX is a
// Photoshop-native Open/Save-As format; Monet lacked it and the Rust `image`
// build has no pcx feature. Decode in TS → PNG → openImage (like [[tga]]/[[pnm]]);
// encode the composite → 24-bit RGB PCX on export. Handles 8-bit-per-plane
// images: 3/4-plane truecolor (RGB/RGBA) and 1-plane indexed (trailing 256-
// colour palette, else grayscale), RLE or uncompressed. Sub-8-bit/EGA-planar is
// rejected. PCX stores each scanline plane-by-plane (all R, then all G, …).

import { checkedBufLen } from "./limits";

export const PCX_RE = /\.pcx$/i;

export interface DecodedPcx { data: Uint8Array; width: number; height: number; }

/** Decode PCX bytes → RGBA, or null if unsupported/corrupt. */
export function decodePcx(bytes: Uint8Array): DecodedPcx | null {
  if (bytes.length < 128 || bytes[0] !== 0x0a) return null; // manufacturer
  const encoding = bytes[2];                 // 0 = raw, 1 = RLE
  const bpp = bytes[3];                       // bits per pixel per plane
  const xmin = bytes[4] | (bytes[5] << 8), ymin = bytes[6] | (bytes[7] << 8);
  const xmax = bytes[8] | (bytes[9] << 8), ymax = bytes[10] | (bytes[11] << 8);
  const nplanes = bytes[65];
  const bytesPerLine = bytes[66] | (bytes[67] << 8);
  const width = xmax - xmin + 1, height = ymax - ymin + 1;
  if (width <= 0 || height <= 0) return null;
  if (bpp !== 8) return null;                 // only 8-bit-per-plane supported
  if (nplanes !== 1 && nplanes !== 3 && nplanes !== 4) return null;
  if (bytesPerLine < width) return null;
  if (encoding !== 0 && encoding !== 1) return null;

  const scanlineLen = bytesPerLine * nplanes;
  const total = scanlineLen * height;
  // `total` comes straight from the header, so cap the dimensions like the engine
  // (MAX_DIM/MAX_PIXELS) and refuse a file that cannot possibly fill it — a
  // 128-byte PCX must not ask for gigabytes (#92). An RLE packet is 2 bytes and
  // emits at most 63, so that is the ceiling on decompressed size.
  const outLen = checkedBufLen(width, height, 4);
  if (outLen == null) return null;
  const avail = bytes.length - 128;
  if (encoding === 1 ? total > Math.floor(avail / 2) * 63 : total > avail) return null;
  const rows = new Uint8Array(total);
  let pos = 128;
  if (encoding === 1) {
    let o = 0;
    while (o < total) {
      if (pos >= bytes.length) return null;
      const b = bytes[pos++];
      if ((b & 0xc0) === 0xc0) {              // run: count in low 6 bits
        const count = b & 0x3f;
        if (pos >= bytes.length) return null;
        const v = bytes[pos++];
        for (let k = 0; k < count && o < total; k++) rows[o++] = v;
      } else rows[o++] = b;
    }
  } else {
    rows.set(bytes.subarray(pos, pos + total));
  }

  const out = new Uint8Array(outLen);
  if (nplanes >= 3) {
    for (let y = 0; y < height; y++) {
      const base = y * scanlineLen;
      for (let x = 0; x < width; x++) {
        const d = (y * width + x) * 4;
        out[d] = rows[base + x];
        out[d + 1] = rows[base + bytesPerLine + x];
        out[d + 2] = rows[base + 2 * bytesPerLine + x];
        out[d + 3] = nplanes === 4 ? rows[base + 3 * bytesPerLine + x] : 255;
      }
    }
  } else {
    // Indexed: a VGA palette (0x0C marker + 768 bytes) may trail the pixel data.
    const pal = bytes.length >= 769 && bytes[bytes.length - 769] === 0x0c ? bytes.subarray(bytes.length - 768) : null;
    for (let y = 0; y < height; y++) {
      const base = y * scanlineLen;
      for (let x = 0; x < width; x++) {
        const idx = rows[base + x];
        const d = (y * width + x) * 4;
        if (pal) { const p = idx * 3; out[d] = pal[p]; out[d + 1] = pal[p + 1]; out[d + 2] = pal[p + 2]; }
        else { out[d] = idx; out[d + 1] = idx; out[d + 2] = idx; } // grayscale fallback
        out[d + 3] = 255;
      }
    }
  }
  return { data: out, width, height };
}

/** Encode RGBA → 24-bit RGB PCX (3-plane, RLE, v5; alpha dropped). */
export function encodePcx(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): Uint8Array {
  const bytesPerLine = width + (width & 1); // spec: even
  const header = new Uint8Array(128);
  header[0] = 0x0a; header[1] = 5; header[2] = 1; header[3] = 8; // manuf, v5, RLE, 8bpp
  header[8] = (width - 1) & 0xff; header[9] = ((width - 1) >> 8) & 0xff;
  header[10] = (height - 1) & 0xff; header[11] = ((height - 1) >> 8) & 0xff;
  header[12] = 72; header[14] = 72;         // dpi
  header[65] = 3;                            // nplanes
  header[66] = bytesPerLine & 0xff; header[67] = (bytesPerLine >> 8) & 0xff;
  header[68] = 1;                            // palette info: colour

  const body: number[] = [];
  const plane = new Uint8Array(bytesPerLine);
  for (let y = 0; y < height; y++) {
    for (let p = 0; p < 3; p++) {
      for (let x = 0; x < bytesPerLine; x++) plane[x] = x < width ? rgba[(y * width + x) * 4 + p] : 0;
      let i = 0;
      while (i < bytesPerLine) {
        const v = plane[i]; let run = 1;
        while (i + run < bytesPerLine && plane[i + run] === v && run < 63) run++;
        if (run > 1 || v >= 0xc0) body.push(0xc0 | run, v); else body.push(v);
        i += run;
      }
    }
  }
  const out = new Uint8Array(128 + body.length);
  out.set(header, 0); out.set(Uint8Array.from(body), 128);
  return out;
}
