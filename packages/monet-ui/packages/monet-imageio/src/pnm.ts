// pnm.ts — Netpbm / Portable Bitmap (.pnm/.ppm/.pgm/.pbm) decode + encode, pure
// & node-safe. Photoshop lists "Portable Bit Map" in Open/Save As; Monet lacked
// it and the Rust `image` build has no pnm feature. Decode in TS → PNG →
// openImage (like [[tga]]); encode the composite → P6 on export. Handles all six
// variants: P1/P4 bitmap, P2/P5 grayscale, P3/P6 RGB (ASCII + binary), with
// header comments and maxval scaling (incl. 16-bit binary samples).

import { checkedBufLen } from "./limits";

export const PNM_RE = /\.(pnm|ppm|pgm|pbm)$/i;

export interface DecodedPnm { data: Uint8Array; width: number; height: number; }

const isSpace = (c: number) => c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d || c === 0x0b || c === 0x0c;

/** Decode Netpbm bytes → RGBA, or null if unsupported/corrupt. */
export function decodePnm(bytes: Uint8Array): DecodedPnm | null {
  if (bytes.length < 2 || bytes[0] !== 0x50 /* 'P' */) return null;
  const type = bytes[1] - 0x30;
  if (type < 1 || type > 6) return null;
  let pos = 2;
  const skipWs = () => {
    while (pos < bytes.length) {
      if (isSpace(bytes[pos])) pos++;
      else if (bytes[pos] === 0x23 /* # */) { while (pos < bytes.length && bytes[pos] !== 0x0a) pos++; }
      else break;
    }
  };
  const token = (): string => {
    skipWs();
    let s = "";
    while (pos < bytes.length && !isSpace(bytes[pos]) && bytes[pos] !== 0x23) { s += String.fromCharCode(bytes[pos]); pos++; }
    return s;
  };

  const width = Number(token());
  const height = Number(token());
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return null;
  const hasMax = type === 2 || type === 3 || type === 5 || type === 6;
  const maxval = hasMax ? Number(token()) : 1;
  if (hasMax && (!Number.isInteger(maxval) || maxval <= 0 || maxval > 65535)) return null;

  const outLen = checkedBufLen(width, height, 4);
  if (outLen == null) return null;
  const n = outLen / 4;
  const out = new Uint8Array(outLen);
  // (#226) Clamp before the maxval===255 short-circuit: binary samples are bytes
  // by construction but an ASCII P2/P3 token is arbitrary, and an out-of-range
  // one wrapped modulo 256 in the Uint8Array (300 → 44, −5 → 251).
  const scale = (v: number) => {
    const c = Math.max(0, Math.min(maxval, v));
    return maxval === 255 ? c : Math.round((c / maxval) * 255);
  };

  if (type <= 3) {
    // ASCII. P1 is a stream of 0/1 chars (whitespace optional); P2/P3 are
    // whitespace-separated decimals.
    const put = (i: number, r: number, g: number, b: number) => { const d = i * 4; out[d] = r; out[d + 1] = g; out[d + 2] = b; out[d + 3] = 255; };
    if (type === 1) {
      for (let i = 0; i < n; i++) {
        skipWs();
        if (pos >= bytes.length) return null;
        const c = bytes[pos++] === 0x31 ? 0 : 255; // '1' → black
        put(i, c, c, c);
      }
    } else {
      const ch = type === 3 ? 3 : 1;
      for (let i = 0; i < n; i++) {
        const v: number[] = [];
        for (let k = 0; k < ch; k++) { const t = token(); if (t === "") return null; v.push(scale(Number(t))); }
        put(i, v[0], ch === 3 ? v[1] : v[0], ch === 3 ? v[2] : v[0]);
      }
    }
    return { data: out, width, height };
  }

  // Binary (P4/P5/P6): exactly one whitespace separates the header from the data.
  if (pos < bytes.length && isSpace(bytes[pos])) pos++;
  if (type === 4) { // PBM: MSB-first packed rows, 1 = black
    const rowBytes = Math.ceil(width / 8);
    if (pos + rowBytes * height > bytes.length) return null;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const bit = (bytes[pos + y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
      const c = bit ? 0 : 255;
      const d = (y * width + x) * 4; out[d] = c; out[d + 1] = c; out[d + 2] = c; out[d + 3] = 255;
    }
    return { data: out, width, height };
  }
  const bps = maxval > 255 ? 2 : 1; // big-endian samples
  const ch = type === 6 ? 3 : 1;
  if (pos + n * ch * bps > bytes.length) return null;
  const sample = (o: number) => scale(bps === 2 ? (bytes[o] << 8) | bytes[o + 1] : bytes[o]);
  for (let i = 0; i < n; i++) {
    const o = pos + i * ch * bps;
    const d = i * 4;
    if (ch === 3) { out[d] = sample(o); out[d + 1] = sample(o + bps); out[d + 2] = sample(o + 2 * bps); }
    else { const g = sample(o); out[d] = g; out[d + 1] = g; out[d + 2] = g; }
    out[d + 3] = 255;
  }
  return { data: out, width, height };
}

/** Encode RGBA → binary P6 PPM (maxval 255, alpha dropped — PPM is opaque RGB). */
export function encodePnm(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): Uint8Array {
  const header = new TextEncoder().encode(`P6\n${width} ${height}\n255\n`);
  const body = new Uint8Array(width * height * 3);
  for (let i = 0, o = 0; o < body.length; i += 4, o += 3) { body[o] = rgba[i]; body[o + 1] = rgba[i + 1]; body[o + 2] = rgba[i + 2]; }
  const out = new Uint8Array(header.length + body.length);
  out.set(header, 0); out.set(body, header.length);
  return out;
}
