// aco.ts — Adobe Color (.aco) swatch files, pure & node-safe. Photoshop's
// Swatches panel imports/exports .aco. We read the version-1 block (present in
// every Photoshop-written .aco; the optional version-2 name block is ignored)
// and write a version-1 RGB block that Photoshop reads back. Colours are
// #rrggbb hex, matching the store's swatch list. Big-endian throughout.
//   https://www.adobe.com/devnet-apps/photoshop/fileformatashtml/ (Color swatch)

import { MAX_IMPORTED_SWATCHES } from "@monet-ui/monet-color";

export const MAX_ACO_IMPORT_BYTES = 1024 * 1024;

const clamp8 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
const hex2 = (v: number) => clamp8(v).toString(16).padStart(2, "0");
const toHex = (r: number, g: number, b: number) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;

/** HSB/HSV → RGB (h in degrees, s/v in [0,1]) → 0..255 floats. */
function hsbToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/** One .aco colour record (space + 4×u16) → #rrggbb, or null to skip the space. */
function recordToHex(space: number, w: number, x: number, y: number, z: number): string | null {
  switch (space) {
    case 0: // RGB — each component 0..65535 (= value·257)
      return toHex(w / 257, x / 257, y / 257);
    case 1: { // HSB
      const [r, g, b] = hsbToRgb((w / 65535) * 360, x / 65535, y / 65535);
      return toHex(r, g, b);
    }
    case 2: { // CMYK — Adobe stores inverted (0 = full ink, 65535 = none)
      const c = 1 - w / 65535, m = 1 - x / 65535, yy = 1 - y / 65535, k = 1 - z / 65535;
      return toHex(255 * (1 - c) * (1 - k), 255 * (1 - m) * (1 - k), 255 * (1 - yy) * (1 - k));
    }
    case 8: { // Grayscale — 0..10000
      const g = (w / 10000) * 255;
      return toHex(g, g, g);
    }
    default: // Lab (7) and unknown spaces → skip (best-effort, never throw)
      return null;
  }
}

/** Parse the version-1 block of an .aco file → array of #rrggbb hex. Robust:
 *  returns [] for empty/short/non-v1 input and stops cleanly on truncation. */
export function parseAco(bytes: Uint8Array, stats?: { dropped: number }): string[] {
  if (bytes.length < 4 || bytes.length > MAX_ACO_IMPORT_BYTES) return [];
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint16(0) !== 1) return []; // Photoshop always writes a v1 block first
  const count = dv.getUint16(2);
  const out: string[] = [];
  let off = 4;
  for (let i = 0; i < count; i++) {
    if (out.length >= MAX_IMPORTED_SWATCHES || off + 10 > bytes.length) {
      if (stats) stats.dropped += count - i;
      break;
    }
    const hex = recordToHex(dv.getUint16(off), dv.getUint16(off + 2), dv.getUint16(off + 4), dv.getUint16(off + 6), dv.getUint16(off + 8));
    off += 10;
    if (hex) out.push(hex);
    else if (stats) stats.dropped++;
  }
  return out;
}

/** Build a version-1 RGB .aco from #rrggbb (or #rgb) hex swatches. */
export function buildAco(hexes: string[]): Uint8Array {
  const bytes = new Uint8Array(4 + hexes.length * 10);
  const dv = new DataView(bytes.buffer);
  dv.setUint16(0, 1); // version 1
  dv.setUint16(2, hexes.length);
  let off = 4;
  for (const hx of hexes) {
    let h = hx.replace(/^#/, "");
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const n = parseInt(h, 16) || 0;
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    dv.setUint16(off, 0); // RGB
    dv.setUint16(off + 2, r * 257);
    dv.setUint16(off + 4, g * 257);
    dv.setUint16(off + 6, b * 257);
    dv.setUint16(off + 8, 0);
    off += 10;
  }
  return bytes;
}
