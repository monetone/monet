// ─────────────────────────────────────────────────────────────
// Crystallize (Filter ▸ Pixelate ▸ Crystallize) — clumps the image into solid-coloured polygonal
// cells: a Voronoi diagram over deterministic, grid-jittered seed points. Each pixel takes the
// colour SAMPLED at its nearest seed, so smoothly-varying regions become flat faceted crystals.
// No global RNG (seeds come from a position hash), so it round-trips and tests reproducibly.
// Engine-free so it unit-tests in node.
//
// The output of each pixel is a COPY of one source pixel (the one at the nearest seed's rounded
// location), so for a grey image (R=G=B) the result is exact — modelled here as one channel. The
// only floating-point work is CHOOSING the nearest seed; the sampled value is copied verbatim.
//
// MUST match `filters.rs crystallize` (grey domain, full selection ⇒ straight copy):
//   cs = max(cell_size, 2)  (i32);  csf = cs as f32
//   seed(gx,gy) = ((gx + jx)·csf, (gy + jy)·csf),  jx = (hash2(gx,gy) & 0xffff)/65535,
//                                                  jy = ((hash2 >> 16) & 0xffff)/65535   (all f32)
//   for pixel (x,y): gx = ⌊x/cs⌋, gy = ⌊y/cs⌋; over the 3×3 grid-cell neighbourhood pick the seed
//   with the smallest f32 squared distance (px−x)²+(py−y²); sample at (round(px), round(py))
//   clamped to the image; output = src at that sample. (`<` keeps the FIRST seed on ties.)
//
// `hash2` is mirrored with `Math.imul` + `>>>0` (u32 wrapping) — exact integer, so a wrong hash is
// caught by any golden. The seed/distance chain uses `Math.fround` per sub-op to reproduce the
// engine's f32 evaluation order; the round is half-away-from-zero (Rust `f32::round`, though
// negative roundings are absorbed by the edge clamp). The SEED-POSITION frounds (jx/jy and
// `(g + j)·csf`) ARE load-bearing: f32 and f64 seed positions pick DIFFERENT nearest seeds at
// ordinary pixels — e.g. (156,185) cell 3 on 300×300 samples (155,186) in f32/engine but (156,187)
// in f64 — and the `engine f32-vs-f64 discriminators` tests pin three such pixels against the real
// engine. The per-DISTANCE frounds, by contrast, never flip the choice in realistic range (0 over a
// 300×300 × cell 2..40 sweep), so they are faithful-but-unwitnessed. The structural goldens use a
// positionally-unique field (v = y·w + x) and pin the hash, seed algebra, round/clamp and selection,
// but are BLIND to f32-vs-f64 (they truncate identically either way) — the discriminator tests are
// what enforce the f32 seed math. Grid indices gx/gy stay < 2^24 for any allocatable raster, so the
// f64 `gx + jx` add is exact and one fround matches the engine's `(gx as f32) + jx`.
// ─────────────────────────────────────────────────────────────

const fr = Math.fround;
/** The engine works in 16-bit; channel values span [0, 65535]. */
export const CRYSTALLIZE_MAX = 65535;

/** The engine's `hash2(x, y) -> u32` (a Murmur-style integer mix), mirrored with u32 wrapping. */
export function hash2(x: number, y: number): number {
  let v = ((Math.imul(x >>> 0, 0x9e3779b1) >>> 0) ^ (Math.imul(y >>> 0, 0x85ebca6b) >>> 0)) >>> 0;
  v = (v ^ (v >>> 15)) >>> 0;
  v = Math.imul(v, 0x2c1b3c6d) >>> 0;
  v = (v ^ (v >>> 12)) >>> 0;
  v = Math.imul(v, 0x297a2d39) >>> 0;
  v = (v ^ (v >>> 15)) >>> 0;
  return v >>> 0;
}

/** Rust `f32::round` — round half AWAY from zero (JS `Math.round` rounds half toward +∞). */
const roundAway = (v: number): number => (v < 0 ? -Math.round(-v) : Math.round(v));
const clampInt = (v: number, hi: number): number => (v < 0 ? 0 : v > hi ? hi : v);

/** The jittered seed position (f32 x, y) for grid cell `(gx, gy)`, pitch `csf = cs as f32`. */
function seedPos(gx: number, gy: number, csf: number): [number, number] {
  const hsh = hash2(gx, gy);
  const jx = fr((hsh & 0xffff) / 65535);
  const jy = fr(((hsh >>> 16) & 0xffff) / 65535);
  return [fr(fr(gx + jx) * csf), fr(fr(gy + jy) * csf)];
}

/** The source sample location `[sx, sy]` for output pixel `(x, y)`: the rounded, clamped position of
 *  the nearest jittered seed (searched over the 3×3 grid-cell neighbourhood). Exposed for testing. */
export function crystallizeSample(x: number, y: number, cs: number, w: number, h: number): [number, number] {
  const csf = fr(cs);
  const gx = Math.floor(x / cs);
  const gy = Math.floor(y / cs);
  let best = Infinity; // engine seeds with f32::MAX; the first neighbour always wins, so this matches
  let sx = x;
  let sy = y;
  for (let dgy = -1; dgy <= 1; dgy++) {
    for (let dgx = -1; dgx <= 1; dgx++) {
      const [px, py] = seedPos(gx + dgx, gy + dgy, csf);
      const ex = fr(px - x);
      const ey = fr(py - y);
      const d = fr(fr(ex * ex) + fr(ey * ey));
      if (d < best) {
        best = d;
        sx = clampInt(roundAway(px), w - 1);
        sy = clampInt(roundAway(py), h - 1);
      }
    }
  }
  return [sx, sy];
}

/** Apply Crystallize to a single-channel (grey) 2-D image (u16 values 0..65535). `cell_size` is
 *  coerced to i32 and floored to ≥2 (mirroring the engine). Does not mutate the input. */
export function crystallize2D(image: readonly (readonly number[])[], cellSize: number): number[][] {
  const h = image.length;
  const w = h > 0 ? image[0].length : 0;
  if (w === 0) return image.map((row) => [...row]);
  const cs = Math.max(cellSize | 0, 2); // `| 0` mirrors the wasm i32 coercion; then max(…, 2)
  return image.map((row, y) =>
    row.map((_, x) => {
      const [sx, sy] = crystallizeSample(x, y, cs, w, h);
      return image[sy][sx];
    }),
  );
}
