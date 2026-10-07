// tga.ts — Truevision TGA (.tga) decode + encode, pure & node-safe. TGA is a
// Photoshop-native format (Open + Save As) Monet lacked entirely; the Rust
// `image` build has no tga feature, so decode in TS → PNG → openImage (like
// [[avif]]/[[svg]]), and encode the composite → .tga on export. Handles the
// common types: 2/10 truecolor (24/32-bit BGR[A], raw or RLE) and 3/11
// grayscale; honours both origin bits. Colour-mapped (1/9) is rejected.

import { checkedBufLen } from "./limits";

export const TGA_RE = /\.tga$/i;

export interface DecodedTga { data: Uint8Array; width: number; height: number; }

/** Decode TGA bytes → top-to-bottom RGBA, or null if unsupported/corrupt. */
export function decodeTga(bytes: Uint8Array): DecodedTga | null {
  if (bytes.length < 18) return null;
  const idLen = bytes[0];
  const colorMapType = bytes[1];
  const imageType = bytes[2];
  const width = bytes[12] | (bytes[13] << 8);
  const height = bytes[14] | (bytes[15] << 8);
  const depth = bytes[16];
  const descriptor = bytes[17];
  if (colorMapType !== 0) return null;            // colour-mapped not supported
  if (width <= 0 || height <= 0) return null;
  if (descriptor & 0xc0) return null;             // interleaved storage — would decode scrambled (#94)
  const truecolor = imageType === 2 || imageType === 10;
  const gray = imageType === 3 || imageType === 11;
  const rle = imageType === 10 || imageType === 11;
  if (!truecolor && !gray) return null;
  if (truecolor && depth !== 24 && depth !== 32) return null;
  if (gray && depth !== 8) return null;
  const bpp = depth >> 3;                          // bytes per stored pixel
  let off = 18 + idLen;                            // skip image-ID field
  // The output buffer is sized from header-declared dimensions, so cap them like
  // the engine (MAX_DIM/MAX_PIXELS) and refuse a file too short to fill them —
  // an 18-byte TGA must not ask for a gigabyte (#92). An RLE packet costs at
  // least 1 + bpp bytes and covers at most 128 pixels.
  const outLen = checkedBufLen(width, height, 4);
  if (outLen == null) return null;
  const n = outLen / 4;
  const avail = bytes.length - off;
  if (rle ? n > Math.floor(avail / (1 + bpp)) * 128 : avail < n * bpp) return null;
  const out = new Uint8Array(outLen);               // RGBA, in stored row order

  const emit = (src: number, dst: number) => {
    if (gray) { const g = bytes[src]; out[dst] = g; out[dst + 1] = g; out[dst + 2] = g; out[dst + 3] = 255; }
    else { out[dst] = bytes[src + 2]; out[dst + 1] = bytes[src + 1]; out[dst + 2] = bytes[src]; out[dst + 3] = bpp === 4 ? bytes[src + 3] : 255; }
  };

  if (!rle) {
    for (let i = 0; i < n; i++, off += bpp) emit(off, i * 4);
  } else {
    let i = 0;
    while (i < n) {
      if (off >= bytes.length) return null;
      const packet = bytes[off++];
      const count = (packet & 0x7f) + 1;
      if (packet & 0x80) {                          // run: one pixel repeated
        if (off + bpp > bytes.length) return null;
        let r = 0, g = 0, b = 0, a = 255;
        if (gray) { r = g = b = bytes[off]; } else { b = bytes[off]; g = bytes[off + 1]; r = bytes[off + 2]; a = bpp === 4 ? bytes[off + 3] : 255; }
        off += bpp;
        for (let k = 0; k < count && i < n; k++, i++) { const d = i * 4; out[d] = r; out[d + 1] = g; out[d + 2] = b; out[d + 3] = a; }
      } else {                                      // raw run of `count` pixels
        if (off + count * bpp > bytes.length) return null;
        for (let k = 0; k < count && i < n; k++, i++, off += bpp) emit(off, i * 4);
      }
    }
  }

  // Origin bits: 0x10 = columns stored right-to-left (#94), 0x20 = rows stored
  // top-to-bottom. Both live in the descriptor byte; honour each independently.
  if (descriptor & 0x10) {
    for (let y = 0; y < height; y++) {
      const r0 = y * width * 4;
      for (let a = 0, b = width - 1; a < b; a++, b--) {
        for (let k = 0; k < 4; k++) {
          const t = out[r0 + a * 4 + k];
          out[r0 + a * 4 + k] = out[r0 + b * 4 + k];
          out[r0 + b * 4 + k] = t;
        }
      }
    }
  }
  if (descriptor & 0x20) return { data: out, width, height };
  const flipped = new Uint8Array(outLen);
  const row = width * 4;
  for (let y = 0; y < height; y++) flipped.set(out.subarray(y * row, y * row + row), (height - 1 - y) * row);
  return { data: flipped, width, height };
}

const samePixel = (p: Uint8Array | Uint8ClampedArray, a: number, b: number) =>
  p[a] === p[b] && p[a + 1] === p[b + 1] && p[a + 2] === p[b + 2] && p[a + 3] === p[b + 3];

/** Encode top-to-bottom RGBA → 32-bit BGRA .tga (raw, or per-row RLE). */
export function encodeTga(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number, opts: { rle?: boolean } = {}): Uint8Array {
  const header = new Uint8Array(18);
  header[2] = opts.rle ? 10 : 2;    // truecolor RLE / raw
  header[12] = width & 0xff; header[13] = (width >> 8) & 0xff;
  header[14] = height & 0xff; header[15] = (height >> 8) & 0xff;
  header[16] = 32;                  // 32-bit
  header[17] = 0x28;                // top-to-bottom origin + 8 alpha bits

  if (!opts.rle) {
    const body = new Uint8Array(width * height * 4);
    for (let i = 0, o = 0; o < body.length; i += 4, o += 4) { body[o] = rgba[i + 2]; body[o + 1] = rgba[i + 1]; body[o + 2] = rgba[i]; body[o + 3] = rgba[i + 3]; }
    const out = new Uint8Array(18 + body.length);
    out.set(header, 0); out.set(body, 18);
    return out;
  }

  const bytes: number[] = [];
  const pushBgra = (i: number) => bytes.push(rgba[i + 2], rgba[i + 1], rgba[i], rgba[i + 3]);
  // RLE packets must not cross a scanline (Photoshop-compatible).
  const runAt = (rowStart: number, x: number): number => {
    let run = 1; const i0 = rowStart + x * 4;
    while (x + run < width && run < 128 && samePixel(rgba, i0, rowStart + (x + run) * 4)) run++;
    return run;
  };
  for (let y = 0; y < height; y++) {
    const rowStart = y * width * 4;
    let x = 0;
    while (x < width) {
      const run = runAt(rowStart, x);
      if (run >= 2) { bytes.push(0x80 | (run - 1)); pushBgra(rowStart + x * 4); x += run; }
      else {
        const start = x; let count = 0;
        while (x < width && count < 128 && runAt(rowStart, x) < 2) { x++; count++; }
        bytes.push(count - 1);
        for (let k = start; k < x; k++) pushBgra(rowStart + k * 4);
      }
    }
  }
  const out = new Uint8Array(18 + bytes.length);
  out.set(header, 0); out.set(Uint8Array.from(bytes), 18);
  return out;
}
