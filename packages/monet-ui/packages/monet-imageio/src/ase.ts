// ase.ts — Adobe Swatch Exchange (.ase), pure & node-safe. This is the swatch
// format Illustrator/InDesign write and Photoshop's Swatches panel also loads;
// unlike .aco (see [[aco]]) colours are stored as normalised floats with a name
// and are grouped. We flatten groups and decode RGB/CMYK/Gray/Lab records;
// big-endian throughout, incl. float32.
//   Format: "ASEF" | u16 major | u16 minor | u32 blockCount | blocks…
//   block:  u16 type (0x0001 colour · 0xC001 group-start · 0xC002 group-end)
//           u32 bodyLen | body
//   colour body: u16 nameLen (UTF-16 units incl. null) | name | 4-byte model
//                ("RGB "/"CMYK"/"LAB "/"GRAY") | float32×N | u16 colourType
//
// A CMYK or spot swatch IS its ink numbers — an illustration app that reduces
// it to #rrggbb on import has already lost the swatch. So the record-level API
// ({@link parseAseSwatches} / {@link buildAseSwatches}) keeps `model` +
// `components` exactly as stored and writes them back unchanged; the hex is
// only a preview. The hex-only {@link parseAse} / {@link buildAse} pair stays
// for callers whose swatch library really is just sRGB (Vision).

import { MAX_IMPORTED_SWATCHES } from "@monet-ui/monet-color";

export const MAX_ASE_IMPORT_BYTES = 8 * 1024 * 1024;

/** Colour models an .ase colour block can carry. */
export type AseModel = "RGB" | "CMYK" | "LAB" | "GRAY";

/** One .ase colour record. `components` are the file's own floats for `model`
 *  (RGB/GRAY 0..1 · CMYK 0..1 ink · LAB L 0..1 then a,b −128..127) — the ink
 *  identity. `hex` is the sRGB preview derived from them. */
export interface AseSwatch {
  name: string;
  hex: string;
  model: AseModel;
  components: number[];
  /** 0 global · 1 spot · 2 normal (Illustrator's swatch type). */
  colorType: number;
}

const clamp8 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
const hex2 = (v: number) => clamp8(v).toString(16).padStart(2, "0");
const toHex = (r: number, g: number, b: number) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;

function ascii4(dv: DataView, off: number): string {
  let s = "";
  for (let i = 0; i < 4; i++) s += String.fromCharCode(dv.getUint8(off + i));
  return s;
}

/** Linear sRGB component → 8-bit sRGB (IEC 61966-2-1 companding). */
function encodeSrgb(u: number): number {
  const c = u <= 0.0031308 ? 12.92 * u : 1.055 * Math.pow(Math.max(u, 0), 1 / 2.4) - 0.055;
  return c * 255;
}

/** CIE Lab (D50, the white point Adobe stores Lab against) → sRGB 0..255.
 *  XYZ→linear-sRGB is the D50-adapted matrix, so no separate Bradford step. */
function labToRgb(L: number, a: number, bb: number): [number, number, number] {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - bb / 200;
  const inv = (f: number) => (f > 6 / 29 ? f * f * f : (3 * (6 / 29) ** 2) * (f - 4 / 29));
  const x = inv(fx) * 0.96422, y = inv(fy), z = inv(fz) * 0.82521; // D50 white
  return [
    encodeSrgb(3.1338561 * x - 1.6168667 * y - 0.4906146 * z),
    encodeSrgb(-0.9787684 * x + 1.9161415 * y + 0.033454 * z),
    encodeSrgb(0.0719453 * x - 0.2289914 * y + 1.4052427 * z),
  ];
}

/** One colour block body (model + floats) → #rrggbb preview.
 *  ponytail: CMYK uses the uncalibrated (1−ink)(1−k) formula — the only honest
 *  answer without an ICC profile, and lossless now that `components` survive.
 *  Route it through a real CMYK profile once colour management ships. */
function modelToHex(model: AseModel, f: number[]): string {
  switch (model) {
    case "RGB":
      return toHex(f[0] * 255, f[1] * 255, f[2] * 255);
    case "GRAY": {
      const g = f[0] * 255;
      return toHex(g, g, g);
    }
    case "CMYK": {
      const [c, m, y, k] = f;
      return toHex(255 * (1 - c) * (1 - k), 255 * (1 - m) * (1 - k), 255 * (1 - y) * (1 - k));
    }
    case "LAB": {
      // L is stored normalised (0..1); a and b are already in Lab units.
      const [r, g, b] = labToRgb(f[0] * 100, f[1], f[2]);
      return toHex(r, g, b);
    }
  }
}

const FLOATS: Record<AseModel, number> = { RGB: 3, GRAY: 1, CMYK: 4, LAB: 3 };

const isAseModel = (s: string): s is AseModel => s === "RGB" || s === "GRAY" || s === "CMYK" || s === "LAB";

/** Parse an .ase file → colour records (groups flattened, names and ink values
 *  preserved). Robust: returns [] for a bad signature/short input and stops
 *  cleanly on truncation. */
export function parseAseSwatches(bytes: Uint8Array, stats?: { dropped: number; partial?: boolean }): AseSwatch[] {
  if (bytes.length < 12 || bytes.length > MAX_ASE_IMPORT_BYTES) return [];
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (ascii4(dv, 0) !== "ASEF") return [];
  const count = dv.getUint32(8);
  const out: AseSwatch[] = [];
  let off = 12;
  for (let i = 0; i < count; i++) {
    if (off + 6 > bytes.length) { if (stats) stats.partial = true; break; } // remaining block types are unknowable
    const type = dv.getUint16(off);
    const bodyLen = dv.getUint32(off + 2);
    const bodyStart = off + 6;
    off = bodyStart + bodyLen; // advance to the next block regardless of parse
    if (off > bytes.length) {
      if (stats) { if (type === 0x0001) stats.dropped++; stats.partial = true; }
      break;
    } // block overruns the file
    if (type !== 0x0001) continue; // 0xC001/0xC002 groups carry no colour
    // (#93) A body shorter than the name-length field itself would put bodyStart
    // at/past EOF and make getUint16 throw, breaking the "never throw" contract.
    if (bodyLen < 2) { if (stats) stats.dropped++; continue; }
    // Colour body: name (u16 units incl. null, UTF-16BE), then model + floats.
    const nameLen = dv.getUint16(bodyStart);
    const modelOff = bodyStart + 2 + nameLen * 2;
    if (modelOff + 4 > bytes.length) { if (stats) stats.dropped++; continue; }
    const model = ascii4(dv, modelOff).trim();
    if (!isAseModel(model)) { if (stats) stats.dropped++; continue; } // unknown model → skip (never throw)
    const n = FLOATS[model];
    if (modelOff + 4 + n * 4 + 2 > bytes.length) { if (stats) stats.dropped++; continue; }
    let name = "";
    for (let k = 0; k < nameLen - 1; k++) name += String.fromCharCode(dv.getUint16(bodyStart + 2 + k * 2));
    const components: number[] = [];
    for (let k = 0; k < n; k++) components.push(dv.getFloat32(modelOff + 4 + k * 4));
    if (out.length >= MAX_IMPORTED_SWATCHES) { if (stats) stats.dropped++; continue; }
    out.push({ name, hex: modelToHex(model, components), model, components, colorType: dv.getUint16(modelOff + 4 + n * 4) });
  }
  return out;
}

/** Parse an .ase file → array of #rrggbb hex (groups flattened). */
export function parseAse(bytes: Uint8Array, stats?: { dropped: number; partial?: boolean }): string[] {
  return parseAseSwatches(bytes, stats).map((s) => s.hex);
}

/** Build an .ase from colour records, writing each one back in its own model —
 *  a CMYK or spot swatch imported from Illustrator leaves as the same ink. */
export function buildAseSwatches(swatches: AseSwatch[]): Uint8Array {
  const blocks = swatches.map((sw) => {
    const n = FLOATS[sw.model];
    const name = sw.name;
    const bodyLen = 2 + (name.length + 1) * 2 + 4 + n * 4 + 2;
    const b = new Uint8Array(6 + bodyLen);
    const dv = new DataView(b.buffer);
    dv.setUint16(0, 0x0001); // colour block
    dv.setUint32(2, bodyLen);
    let p = 6;
    dv.setUint16(p, name.length + 1); p += 2; // UTF-16 units incl. null
    for (let i = 0; i < name.length; i++) { dv.setUint16(p, name.charCodeAt(i)); p += 2; }
    dv.setUint16(p, 0); p += 2; // null terminator
    const tag = sw.model.padEnd(4, " ");
    for (let i = 0; i < 4; i++) b[p + i] = tag.charCodeAt(i);
    p += 4;
    for (let k = 0; k < n; k++) { dv.setFloat32(p, sw.components[k] ?? 0); p += 4; }
    dv.setUint16(p, sw.colorType);
    return b;
  });
  const bytes = new Uint8Array(12 + blocks.reduce((total, b) => total + b.length, 0));
  const dv = new DataView(bytes.buffer);
  bytes[0] = 0x41; bytes[1] = 0x53; bytes[2] = 0x45; bytes[3] = 0x46; // "ASEF"
  dv.setUint16(4, 1); dv.setUint16(6, 0); // version 1.0
  dv.setUint32(8, blocks.length);
  let off = 12;
  for (const b of blocks) { bytes.set(b, off); off += b.length; }
  return bytes;
}

/** Normalise `#rgb`/`rrggbb` → the six lower-case hex digits. */
function hex6(hx: string): string {
  let h = hx.replace(/^#/, "").toLowerCase();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return (h + "000000").slice(0, 6);
}

/** An sRGB `#rrggbb` (or `#rgb`) as a normal RGB record named by its hex — the
 *  fallback for a colour with no ink identity of its own. */
export function aseSwatchFromHex(hex: string): AseSwatch {
  const h = hex6(hex);
  const n = parseInt(h, 16) || 0;
  return {
    name: h,
    hex: `#${h}`,
    model: "RGB",
    components: [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255],
    colorType: 2, // normal
  };
}

/** Build an .ase from #rrggbb (or #rgb) hex swatches (one RGB colour per block,
 *  named by its hex). Photoshop/Illustrator read it back. */
export function buildAse(hexes: string[]): Uint8Array {
  return buildAseSwatches(hexes.map(aseSwatchFromHex));
}
