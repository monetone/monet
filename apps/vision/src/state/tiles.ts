// ─────────────────────────────────────────────────────────────
// Tiles (Filter ▸ Stylize ▸ Tiles) — breaks the image into an nt×nt grid of rectangular tiles and
// shifts each tile by a (deterministically hashed) offset of up to `maxOffset` of the tile size.
// The gaps the tiles vacate reveal a CANVAS chosen by `fillMode`: 0 background colour · 1 foreground
// colour · 2 the inverted image · 3 the unaltered image. Deterministic (offsets come from a position
// hash), so it round-trips and unit-tests in node. Engine-free.
//
// Each output pixel is either a canvas value (bg·257, fg·257, 65535−v, or v) or a COPY of a source
// pixel, so for a grey image (R=G=B) the result is exact — modelled here as one channel. The only
// floating-point work is the per-tile offset; the pixels themselves are copied/filled verbatim.
//
// MUST match `filters.rs tiles` (grey domain, full selection ⇒ straight copy):
//   nt = max(num_tiles, 1);  canvas = {3:v, 2:65535−v, 1:fg·257, _:bg·257}
//   tile (ti,tj) spans [ti·w/nt, (ti+1)·w/nt) × [tj·h/nt, (tj+1)·h/nt)   (i32 division)
//   tw,th = tile width/height;  h = hash2(ti,tj)
//   ox = round( ((h&0xffff)/65535·2 − 1)·tw·maxOffset );  oy likewise with (h>>16)&0xffff, th
//   every source pixel (x,y) in the tile is copied to (x+ox, y+oy) when that lands in-bounds;
//   later tiles (row-major) overwrite earlier ones where offsets overlap.
//
// `hash2` is exact integer (Math.imul + >>>0). The offset chain uses `Math.fround` per sub-op — and
// frounds `maxOffset` once (it is an f32 at the wasm boundary) — so `round` lands on the same integer
// as the engine; the round is half-away-from-zero (Rust `f32::round`). The offset round is the only
// f32-sensitive step; the copied/filled values are exact.
// ─────────────────────────────────────────────────────────────

const fr = Math.fround;
/** The engine works in 16-bit; channel values span [0, 65535]. */
export const TILES_MAX = 65535;

/** The engine's `hash2(x, y) -> u32` (Murmur-style mix), mirrored with u32 wrapping. Shared with
 *  Crystallize/Stained Glass; kept local so this module stays self-contained. */
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

/** The integer pixel offset for one axis: `round( (frac·2 − 1)·tileSize·maxOffset )`, where `frac`
 *  is the 16-bit hash fraction. Exposed for testing. `maxOffset` is pre-frounded (f32 at the wasm
 *  boundary). All sub-ops are frounded to match the engine's f32 evaluation order. */
export function tileOffset(frac16: number, tileSize: number, maxOffset: number): number {
  const f = fr(frac16 / 65535);
  const centred = fr(fr(f * 2) - 1); // ∈ [−1, 1)
  const scaled = fr(fr(centred * tileSize) * maxOffset);
  const r = roundAway(scaled);
  return r === r ? r : 0; // Rust `f32 NaN as i32 == 0`: a NaN maxOffset ⇒ no shift (identity), not NaN
}

/** Apply Tiles to a single-channel (grey) 2-D image (u16 values 0..65535). `numTiles` ≥ 1 is the
 *  grid count per axis, `maxOffset` the max shift as a fraction of tile size, `fillMode` 0 bg · 1 fg
 *  · 2 inverse · 3 unaltered, and `fg`/`bg` are u8 grey levels. Does not mutate the input. */
export function tiles2D(
  image: readonly (readonly number[])[],
  numTiles: number,
  maxOffset: number,
  fillMode: number,
  fg = 0,
  bg = 255,
): number[][] {
  const h = image.length;
  const w = h > 0 ? image[0].length : 0;
  if (w === 0) return image.map((row) => [...row]);
  // num_tiles is a u32 the engine then casts `as i32`: a huge/negative count wraps to a negative nt,
  // whose tile loops run zero times ⇒ the canvas shows through everywhere (matches the engine).
  const nt = Math.max(numTiles >>> 0, 1) | 0;
  const mo = fr(maxOffset); // the wasm boundary rounds max_offset to f32
  const fm = fillMode & 0xff; // fill_mode is a u8 at the wasm boundary (truncates 2.5→2, −1→255, …)

  // the canvas the tiles sit on (shows through the gaps the tiles vacate)
  let canvas: number[][];
  if (fm === 3) canvas = image.map((row) => [...row]); // unaltered image
  else if (fm === 2) canvas = image.map((row) => row.map((v) => TILES_MAX - v)); // inverse
  else {
    const fill = (fm === 1 ? fg : bg) * 257; // 1 fg, else bg
    canvas = Array.from({ length: h }, () => new Array<number>(w).fill(fill));
  }

  for (let tj = 0; tj < nt; tj++) {
    const y0 = Math.trunc((tj * h) / nt);
    const y1 = Math.trunc(((tj + 1) * h) / nt);
    for (let ti = 0; ti < nt; ti++) {
      const x0 = Math.trunc((ti * w) / nt);
      const x1 = Math.trunc(((ti + 1) * w) / nt);
      const hsh = hash2(ti, tj);
      const ox = tileOffset(hsh & 0xffff, x1 - x0, mo);
      const oy = tileOffset((hsh >>> 16) & 0xffff, y1 - y0, mo);
      for (let y = y0; y < y1; y++) {
        const dy = y + oy;
        if (dy < 0 || dy >= h) continue;
        for (let x = x0; x < x1; x++) {
          const dx = x + ox;
          if (dx >= 0 && dx < w) canvas[dy][dx] = image[y][x];
        }
      }
    }
  }
  return canvas;
}
