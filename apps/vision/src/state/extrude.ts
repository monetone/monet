// ─────────────────────────────────────────────────────────────
// Extrude (Filter ▸ Stylize ▸ Extrude) — tiles the image into a grid of square blocks and renders
// each as a raised 3-D block: the block is flooded with its own AVERAGE colour, then an inset "top
// face" is kept at full brightness while the surrounding border (the block's "sides") is darkened,
// giving a field of extruded tiles. The extrusion depth of each block is driven either by its
// BRIGHTNESS (brighter ⇒ taller ⇒ larger inset) or by a deterministic per-block HASH (seeded), so
// it round-trips and unit-tests in node. Engine-free.
//
// Each channel uses the same per-block average and the same top/side factor, so a grey image
// (R=G=B) maps to `extrude` bit-for-bit — modelled here as one channel.
//
// MUST match `filters.rs extrude` (grey domain, full selection ⇒ straight copy):
//   cell = max(size, 2);  depth = clamp(depth, 0, 1)
//   per block [cx0,cx1)×[cy0,cy1) (cell pitch from 0, last block clipped to the edge):
//     avg = floor(Σ v / cnt)                              (u64 integer average over the block)
//     f   = by_brightness ? (0.299·avg + 0.587·avg + 0.114·avg)/65535   (Rec.601 luma, f32)
//                         : hash(cx0/cell, cy0/cell)       (seeded f32 in [0,1))
//     inset = round(depth · f · (cell/2))                 (f32 → i32)
//     each pixel: on_top = inset ≤ x−cx0 < (cx1−cx0)−inset AND same for y;
//                 out = trunc(avg · (on_top ? 1.0 : 0.45))   (full top face vs darkened side)
//
// The hash is a SEEDED u32 mix (constants 0x9E3779B1 / 0x85EBCA6B / 0x7FEB352D — NOT the shared
// hash2), mirrored with `Math.imul` + `>>>0`. The integer average is exact; `Math.fround` per sub-op
// reproduces the engine's f32 for luma, the inset (round half-away-from-zero = Rust `f32::round`),
// and the 0.45 side-darkening; `as u16` truncates. Only the inset and luma use f32; the rest is exact.
// ─────────────────────────────────────────────────────────────

const fr = Math.fround;
/** The engine works in 16-bit; channel values span [0, 65535]. */
export const EXTRUDE_MAX = 65535;

const C_R = fr(0.299);
const C_G = fr(0.587);
const C_B = fr(0.114);
const SIDE_K = fr(0.45); // darkening factor for the block's sides (vs 1.0 on the top face)

/** Rust `f32::round` — round half AWAY from zero. */
const roundAway = (v: number): number => (v < 0 ? -Math.round(-v) : Math.round(v));
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** The engine's seeded per-block hash → f32 in [0, 1). `a`,`b` are block indices, `seed` a u32. */
export function extrudeHash(a: number, b: number, seed: number): number {
  let v = ((Math.imul(a >>> 0, 0x9e3779b1) >>> 0) ^ (Math.imul(b >>> 0, 0x85ebca6b) >>> 0) ^ (seed >>> 0)) >>> 0;
  v = (v ^ (v >>> 16)) >>> 0;
  v = Math.imul(v, 0x7feb352d) >>> 0;
  v = (v ^ (v >>> 15)) >>> 0;
  return fr((v & 0xffff) / 65536);
}

/** The Rec.601 luma `f = (0.299·v + 0.587·v + 0.114·v)/65535` of a grey block average. Exposed. */
export function extrudeLuma(avg: number): number {
  return fr(fr(fr(fr(C_R * avg) + fr(C_G * avg)) + fr(C_B * avg)) / 65535);
}

/** The inset (in pixels) for a block: `round(depth · f · (cell/2))`. Exposed for testing. A NaN
 *  result maps to 0, matching Rust `f32 NaN as i32 == 0` (a NaN depth ⇒ inset 0 ⇒ all-top mosaic). */
export function extrudeInset(depth: number, f: number, cell: number): number {
  const r = roundAway(fr(fr(fr(depth) * f) * fr(cell / 2)));
  return r === r ? r : 0;
}

/** Apply Extrude to a single-channel (grey) 2-D image (u16 values 0..65535). `size` (≥2 after clamp)
 *  is the block pitch, `depth` ∈ [0,1] the extrusion amount, `byBrightness` chooses brightness- vs
 *  hash-driven height, and `seed` (u32) seeds the hash. Does not mutate the input. */
export function extrude2D(
  image: readonly (readonly number[])[],
  size: number,
  depth: number,
  byBrightness: boolean,
  seed = 0,
): number[][] {
  const h = image.length;
  const w = h > 0 ? image[0].length : 0;
  if (w === 0) return image.map((row) => [...row]);
  const cell = Math.max(size | 0, 2);
  const d = clamp01(fr(depth));
  const out: number[][] = Array.from({ length: h }, () => new Array<number>(w));

  for (let cy0 = 0; cy0 < h; cy0 += cell) {
    const cy1 = Math.min(cy0 + cell, h);
    for (let cx0 = 0; cx0 < w; cx0 += cell) {
      const cx1 = Math.min(cx0 + cell, w);
      // integer average over the block (u64 sum / count, truncated — matches the engine)
      let sum = 0;
      let cnt = 0;
      for (let y = cy0; y < cy1; y++) for (let x = cx0; x < cx1; x++) { sum += image[y][x]; cnt++; }
      const avg = Math.floor(sum / cnt);
      const f = byBrightness ? extrudeLuma(avg) : extrudeHash(cx0 / cell, cy0 / cell, seed);
      const inset = extrudeInset(d, f, cell);
      const top = avg; // avg · 1.0
      const side = Math.trunc(fr(avg * SIDE_K));
      for (let y = cy0; y < cy1; y++) {
        const onTopY = y >= cy0 + inset && y < cy1 - inset;
        const row = out[y];
        for (let x = cx0; x < cx1; x++) {
          row[x] = onTopY && x >= cx0 + inset && x < cx1 - inset ? top : side;
        }
      }
    }
  }
  return out;
}
