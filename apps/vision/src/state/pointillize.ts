// ─────────────────────────────────────────────────────────────
// Pointillize (Filter ▸ Pixelate ▸ Pointillize) — scatters the image into round dots of solid colour
// on a flat background, like a pointillist painting. Seeds sit on a jittered grid (the SAME Voronoi
// layout as Crystallize); each pixel finds its nearest seed and, if it falls within that seed's dot
// (radius = half the cell pitch), takes the colour sampled at the seed — otherwise it shows the
// background colour. Deterministic (seeds from a position hash), so it round-trips and unit-tests in
// node. Engine-free.
//
// Each output pixel is either a COPY of one source pixel (inside a dot) or the flat background, so a
// grey image (R=G=B) with a grey background maps to `pointillize` bit-for-bit — modelled here as one
// channel. The only floating-point work is choosing the nearest seed and the dot-radius test.
//
// MUST match `filters.rs pointillize` (grey domain, full selection ⇒ straight copy):
//   cs = max(cell_size, 2);  csf = cs as f32;  r2 = (csf·0.5)²   (dot radius² = (cell/2)²)
//   seed(gx,gy) = ((gx+jx)·csf, (gy+jy)·csf),  jx = (hash2(gx,gy)&0xffff)/65535, jy = (…>>16…)/65535
//   for pixel (x,y): gx=⌊x/cs⌋, gy=⌊y/cs⌋; over the 3×3 grid-cell neighbourhood pick the seed with the
//   smallest f32 squared distance `best`; sample at (round(px),round(py)) clamped to the image;
//   out = best ≤ r2 ? src[sample] : bg·257
//
// `hash2` is mirrored with `Math.imul` + `>>>0` (u32 wrapping). The seed/distance/r2 chain uses
// `Math.fround` per sub-op to reproduce the engine's f32 evaluation order; the round is half-away-
// from-zero (Rust `f32::round`). Two results are f32-sensitive and observable: the seed POSITION (its
// rounded x/y can flip by one even when the nearest seed is unambiguous, sampling a different in-dot
// pixel) and the `best ≤ r2` dot-boundary test; the sampled/background values are then exact.
// ─────────────────────────────────────────────────────────────

const fr = Math.fround;
/** The engine works in 16-bit; channel values span [0, 65535]. */
export const POINTILLIZE_MAX = 65535;

/** The Voronoi hash (shared layout with Crystallize), mirrored with u32 wrapping. */
export function hash2(x: number, y: number): number {
  let v = ((Math.imul(x >>> 0, 0x9e3779b1) >>> 0) ^ (Math.imul(y >>> 0, 0x85ebca6b) >>> 0)) >>> 0;
  v = (v ^ (v >>> 15)) >>> 0;
  v = Math.imul(v, 0x2c1b3c6d) >>> 0;
  v = (v ^ (v >>> 12)) >>> 0;
  v = Math.imul(v, 0x297a2d39) >>> 0;
  v = (v ^ (v >>> 15)) >>> 0;
  return v >>> 0;
}

/** Rust `f32::round` — round half AWAY from zero. */
const roundAway = (v: number): number => (v < 0 ? -Math.round(-v) : Math.round(v));
const clampInt = (v: number, hi: number): number => (v < 0 ? 0 : v > hi ? hi : v);

/** The dot radius² for a cell size: `(cs·0.5)²` as the engine computes it (f32). Exposed. */
export function pointillizeRadiusSq(cs: number): number {
  const t = fr(fr(cs) * 0.5);
  return fr(t * t);
}

function seedPos(gx: number, gy: number, csf: number): [number, number] {
  const hsh = hash2(gx, gy);
  const jx = fr((hsh & 0xffff) / 65535);
  const jy = fr(((hsh >>> 16) & 0xffff) / 65535);
  return [fr(fr(gx + jx) * csf), fr(fr(gy + jy) * csf)];
}

/** The nearest seed for output pixel `(x, y)`: `[sx, sy, best]` — the rounded/clamped sample location
 *  and the f32 squared distance to it (compare with the dot radius²). Exposed for testing. */
export function pointillizeSeed(x: number, y: number, cs: number, w: number, h: number): [number, number, number] {
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
  return [sx, sy, best];
}

/** Apply Pointillize to a single-channel (grey) 2-D image (u16 values 0..65535) with grey background
 *  `bg` (u8). `cellSize` is coerced to i32 and floored to ≥2 (mirroring the engine). Pixels inside a
 *  dot take the sampled seed value; the gaps show `bg·257`. Does not mutate the input. */
export function pointillize2D(image: readonly (readonly number[])[], cellSize: number, bg = 255): number[][] {
  const h = image.length;
  const w = h > 0 ? image[0].length : 0;
  if (w === 0) return image.map((row) => [...row]);
  const cs = Math.max(cellSize | 0, 2); // `| 0` mirrors the wasm i32 coercion; then max(…, 2)
  const r2 = pointillizeRadiusSq(cs);
  const bg16 = bg * 257;
  return image.map((row, y) =>
    row.map((_, x) => {
      const [sx, sy, best] = pointillizeSeed(x, y, cs, w, h);
      return best <= r2 ? image[sy][sx] : bg16;
    }),
  );
}
