// cubeLut.ts — Adobe/IRIDAS 3D LUT (.cube) parsing + trilinear application, pure
// & node-safe. Photoshop loads .cube 3D LUTs into a Color Lookup adjustment;
// Monet could already EXPORT one (engine.export_color_lut) but not import/apply
// one — this closes that asymmetry. Data ordering matches the engine exporter:
// red varies fastest, then green, then blue (index = (b·n + g)·n + r).

export interface CubeLut {
  size: number;                 // N (grid points per axis)
  data: Float32Array;           // N³·3 output triplets, red-fastest
  domainMin: [number, number, number];
  domainMax: [number, number, number];
}

export const MAX_CUBE_LUT_IMPORT_BYTES = 16 * 1024 * 1024;
export const MAX_CUBE_LUT_SIZE = 64;
const MAX_CUBE_LUT_VALUES = MAX_CUBE_LUT_SIZE ** 3 * 3;

/** Parse .cube text → a 3D LUT, or null if it isn't a usable 3D LUT (1D LUTs,
 *  bad sizes, and truncated data all return null; never throws). */
export function parseCubeLut(text: string): CubeLut | null {
  // Reject before split() duplicates the input into a large line array, and
  // bound numeric accumulation even when LUT_3D_SIZE is missing or appears late.
  if (text.length > MAX_CUBE_LUT_IMPORT_BYTES) return null;
  let size = 0;
  let domainMin: [number, number, number] = [0, 0, 0];
  let domainMax: [number, number, number] = [1, 1, 1];
  const values: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (/^LUT_1D_SIZE/i.test(line)) return null; // 1D LUTs aren't 3D colour tables
    let m = line.match(/^LUT_3D_SIZE\s+(\d+)/i);
    if (m) {
      size = parseInt(m[1], 10);
      if (size < 2 || size > MAX_CUBE_LUT_SIZE) return null;
      continue;
    }
    m = line.match(/^DOMAIN_MIN\s+(\S+)\s+(\S+)\s+(\S+)/i);
    if (m) { domainMin = [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])]; continue; }
    m = line.match(/^DOMAIN_MAX\s+(\S+)\s+(\S+)\s+(\S+)/i);
    if (m) { domainMax = [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])]; continue; }
    if (/^[A-Za-z_]/.test(line)) continue; // TITLE and any other keyword
    const p = line.split(/\s+/);
    if (p.length < 3) continue;
    const r = parseFloat(p[0]), g = parseFloat(p[1]), b = parseFloat(p[2]);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) continue;
    if (values.length > MAX_CUBE_LUT_VALUES - 3) return null;
    values.push(r, g, b);
  }
  if (size < 2 || size > MAX_CUBE_LUT_SIZE) return null;
  if (values.length !== size * size * size * 3) return null;
  return { size, data: Float32Array.from(values), domainMin, domainMax };
}

/** Parse Autodesk/Lustre .3dl text into the same CubeLut shape. In the file,
 *  blue varies fastest (red slowest) — the opposite of .cube — so entries are
 *  re-packed to red-fastest here. Integer outputs are normalised by the
 *  smallest standard full-scale (10/12/16-bit) that holds the data. Null when
 *  the text isn't a usable 3D LUT; never throws. */
export function parse3dlLut(text: string): CubeLut | null {
  if (text.length > MAX_CUBE_LUT_IMPORT_BYTES) return null;
  let size = 0;
  const values: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || /^[A-Za-z]/.test(line)) continue; // comments + keywords (3DMESH, mesh, …)
    const p = line.split(/\s+/).map(Number);
    if (p.some((v) => !Number.isFinite(v))) continue;
    if (!size) {
      // First numeric line must be the input mesh: ≥2 strictly-increasing
      // values whose count is the lattice size. Exactly 3 values would be
      // ambiguous with a data triple — real meshes never have 3 points.
      if (p.length >= 2 && p.length !== 3 && p.every((v, i) => i === 0 || v > p[i - 1])) {
        size = p.length;
        if (size > MAX_CUBE_LUT_SIZE) return null;
        continue;
      }
      return null; // data (or garbage) before a mesh line isn't a .3dl
    }
    if (p.length !== 3) continue;
    if (values.length > MAX_CUBE_LUT_VALUES - 3) return null;
    values.push(p[0], p[1], p[2]);
  }
  if (!size || values.length !== size ** 3 * 3) return null;
  let peak = 0;
  for (const v of values) {
    if (v < 0) return null;
    if (v > peak) peak = v;
  }
  const scale = peak <= 1023 ? 1023 : peak <= 4095 ? 4095 : peak <= 65535 ? 65535 : 0;
  if (!scale) return null;
  const n = size;
  const data = new Float32Array(n * n * n * 3);
  let src = 0;
  for (let r = 0; r < n; r++) {
    for (let g = 0; g < n; g++) {
      for (let b = 0; b < n; b++, src += 3) {
        const dst = ((b * n + g) * n + r) * 3;
        data[dst] = values[src] / scale;
        data[dst + 1] = values[src + 1] / scale;
        data[dst + 2] = values[src + 2] / scale;
      }
    }
  }
  return { size: n, data, domainMin: [0, 0, 0], domainMax: [1, 1, 1] };
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Trilinearly sample the LUT for a normalised RGB input (each 0..1) → output. */
export function sampleLut3D(lut: CubeLut, r: number, g: number, b: number): [number, number, number] {
  const { size: n, data, domainMin, domainMax } = lut;
  const nf = n - 1;
  const axis = (v: number, lo: number, hi: number) => clamp01(hi > lo ? (v - lo) / (hi - lo) : 0) * nf;
  const fr = axis(r, domainMin[0], domainMax[0]);
  const fg = axis(g, domainMin[1], domainMax[1]);
  const fb = axis(b, domainMin[2], domainMax[2]);
  const r0 = Math.floor(fr), g0 = Math.floor(fg), b0 = Math.floor(fb);
  const r1 = Math.min(r0 + 1, nf), g1 = Math.min(g0 + 1, nf), b1 = Math.min(b0 + 1, nf);
  const dr = fr - r0, dg = fg - g0, db = fb - b0;
  const idx = (ri: number, gi: number, bi: number) => ((bi * n + gi) * n + ri) * 3;
  const lerp = (a: number, c: number, t: number) => a + (c - a) * t;
  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const c00 = lerp(data[idx(r0, g0, b0) + c], data[idx(r1, g0, b0) + c], dr);
    const c10 = lerp(data[idx(r0, g1, b0) + c], data[idx(r1, g1, b0) + c], dr);
    const c01 = lerp(data[idx(r0, g0, b1) + c], data[idx(r1, g0, b1) + c], dr);
    const c11 = lerp(data[idx(r0, g1, b1) + c], data[idx(r1, g1, b1) + c], dr);
    out[c] = lerp(lerp(c00, c10, dg), lerp(c01, c11, dg), db);
  }
  return out;
}

/** Apply the LUT to an RGBA buffer → a new RGBA buffer (alpha preserved). */
export function applyCubeLut(lut: CubeLut, rgba: Uint8Array | Uint8ClampedArray): Uint8Array {
  const out = new Uint8Array(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const [r, g, b] = sampleLut3D(lut, rgba[i] / 255, rgba[i + 1] / 255, rgba[i + 2] / 255);
    out[i] = Math.round(clamp01(r) * 255);
    out[i + 1] = Math.round(clamp01(g) * 255);
    out[i + 2] = Math.round(clamp01(b) * 255);
    out[i + 3] = rgba[i + 3];
  }
  return out;
}

/** Same sample as `applyCubeLut`, on the engine's 16-bit samples, so a wide-gamut
 *  or 16-bit document is graded from its own numbers rather than an 8-bit preview. */
export function applyCubeLut16(lut: CubeLut, rgba: Uint16Array): Uint16Array {
  const out = new Uint16Array(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const [r, g, b] = sampleLut3D(lut, rgba[i] / 65535, rgba[i + 1] / 65535, rgba[i + 2] / 65535);
    out[i] = Math.round(clamp01(r) * 65535);
    out[i + 1] = Math.round(clamp01(g) * 65535);
    out[i + 2] = Math.round(clamp01(b) * 65535);
    out[i + 3] = rgba[i + 3];
  }
  return out;
}
