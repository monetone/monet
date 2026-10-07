// ─────────────────────────────────────────────────────────────
// Mosaic Tiles (Filter ▸ Texture ▸ Mosaic Tiles) — lays a grid of grout lines over the image so it
// looks like ceramic mosaic tiles: a band of `grout` px at the start of every `tile`-px cell (both
// axes) is washed toward a chosen grout colour, while each tile interior keeps the image. Unlike
// the average-based mosaic, the tiles themselves are untouched — only the grout lattice is painted.
// Deterministic; engine-free so it unit-tests in node.
//
// The grout wash blends each channel toward the same grey grout target, so a grey image (R=G=B)
// matches `mosaic_tiles` bit-for-bit — modelled here as one channel.
//
// MUST match `filters.rs mosaic_tiles` (full selection ⇒ cov 1):
//   tile = max(tile_size, 2);  grout = clamp(grout_width, 0, tile−1);  grout ≤ 0 → identity
//   target = clamp(lighten_grout,0,1)·65535;  strength = 0.85
//   per pixel: if (x mod tile ≥ grout) ∧ (y mod tile ≥ grout) → tile interior, unchanged
//              else (grout line) → px = clamp(v + (target − v)·strength·cov, 0, 65535) as u16
//                                  (cov=1 ⇒ v + (target−v)·0.85; TRUNCATES)
//
// Fully bit-exact: the grout mask is integer modulo (exact), and the wash is + − × or a clamp/cast
// (no trig, no sqrt). `Math.fround` per sub-op reproduces the engine's f32 order.
// ─────────────────────────────────────────────────────────────

const fr = Math.fround;
/** The engine works in 16-bit; channel values span [0, 65535]. */
export const MOSAIC_TILES_MAX = 65535;
const STRENGTH = fr(0.85); // how strongly the grout overrides the image

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const clampU16 = (x: number): number => (x < 0 ? 0 : x > MOSAIC_TILES_MAX ? MOSAIC_TILES_MAX : x);

/** Effective tile size (≥2) and grout width (0..tile−1) for the requested params. Exposed. */
export function mosaicTilesGeometry(tileSize: number, groutWidth: number): { tile: number; grout: number } {
  const tile = Math.max(Math.trunc(tileSize), 2);
  const g = Math.trunc(groutWidth);
  const grout = g < 0 ? 0 : g > tile - 1 ? tile - 1 : g;
  return { tile, grout };
}

/** Whether `(x, y)` falls on a grout line (the first `grout` px of each `tile` cell, on either
 *  axis). Tile interiors return false. Exposed for testing. */
export function isGrout(x: number, y: number, tile: number, grout: number): boolean {
  return x % tile < grout || y % tile < grout;
}

/** Apply Mosaic Tiles to a single-channel (grey) 2-D image (u16 values 0..65535). `tile_size`
 *  (≥2 effective) is the cell size, `grout_width` (clamped to [0,tile−1]) the line thickness, and
 *  `lighten_grout` ∈ [0,1] the grout grey (0 black .. 1 white). Does not mutate the input. */
export function mosaicTiles2D(
  image: readonly (readonly number[])[],
  tileSize: number,
  groutWidth: number,
  lightenGrout: number,
): number[][] {
  const out = image.map((row) => [...row]);
  const { tile, grout } = mosaicTilesGeometry(tileSize, groutWidth);
  if (grout <= 0) return out; // no grout → identity
  const target = fr(clamp01(fr(lightenGrout)) * 65535);
  for (let y = 0; y < out.length; y++) {
    const row = out[y];
    for (let x = 0; x < row.length; x++) {
      if (!isGrout(x, y, tile, grout)) continue; // tile interior — image shows through
      const v = row[x];
      const washed = fr(v + fr(fr(target - v) * STRENGTH)); // cov = 1
      row[x] = Math.trunc(clampU16(washed));
    }
  }
  return out;
}
