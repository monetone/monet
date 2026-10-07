// ─────────────────────────────────────────────────────────────
// Mezzotint (Filter ▸ Pixelate ▸ Mezzotint) — converts each channel to a pure black/white pattern by
// THRESHOLDING the normalised channel value against a deterministic per-cell hash: where the value
// clears the threshold the channel is forced to full (65535), otherwise to 0. The cell shape is set
// by `kind`: dots (per pixel / 2×2 / 3×3 blocks) or scan lines (horizontal / vertical). Deterministic
// (the threshold comes from a seeded hash), so it round-trips and unit-tests in node. Engine-free.
//
// The threshold depends on the CHANNEL index (`hash(bx, by, k)`), so the three channels dither
// INDEPENDENTLY — a grey pixel does NOT stay grey. This module models ONE channel (pass `channel`
// 0/1/2); a full RGB caller runs it three times. With `channel = 0` it matches the engine's red
// channel bit-for-bit, which is what the goldens validate.
//
// MUST match `filters.rs mezzotint` (one channel k):
//   block = kind==0 ? 1 : kind==1 ? 2 : 3
//   (bx, by) = kind==3 ? (0, y)            // horizontal lines
//            : kind==4 ? (x, 0)            // vertical lines
//            :          (⌊x/block⌋, ⌊y/block⌋)   // dots (kinds 0,1,2)
//   out = (v/65535) >= hash(bx, by, k) ? 65535 : 0
//
// The hash is a SEEDED 3-input u32 mix (constants 0x9E3779B1 / 0x85EBCA6B / 0xC2B2AE35 / 0x7FEB352D),
// mirrored with `Math.imul` + `>>>0`. `Math.fround` reproduces the engine's f32 for `v/65535` (a
// correctly-rounded division) and the hash's `/65536`; the `>=` compare is then exact. Only that
// compare is f32-sensitive; everything else is integer.
// ─────────────────────────────────────────────────────────────

const fr = Math.fround;
/** The engine works in 16-bit; channel values span [0, 65535]. */
export const MEZZOTINT_MAX = 65535;

/** The engine's seeded 3-input per-cell hash → f32 in [0, 1). `a`,`b` are cell coords, `c` the
 *  channel index, `seed` a u32. Mirrored with u32 wrapping (Math.imul + >>>0). */
export function mezzotintHash(a: number, b: number, c: number, seed: number): number {
  let v = ((Math.imul(a >>> 0, 0x9e3779b1) >>> 0) ^ (Math.imul(b >>> 0, 0x85ebca6b) >>> 0) ^ (Math.imul(c >>> 0, 0xc2b2ae35) >>> 0) ^ (seed >>> 0)) >>> 0;
  v = (v ^ (v >>> 16)) >>> 0;
  v = Math.imul(v, 0x7feb352d) >>> 0;
  v = (v ^ (v >>> 15)) >>> 0;
  return fr((v & 0xffff) / 65536);
}

/** The block pitch for a `kind`: 1 (kind 0), 2 (kind 1), else 3 (kinds 2/3/4; unused for lines). */
export function mezzotintBlock(kind: number): number {
  return kind === 0 ? 1 : kind === 1 ? 2 : 3;
}

/** Apply Mezzotint to a single-channel 2-D image (u16 values 0..65535) for channel index `channel`
 *  (0/1/2). `kind` selects the cell pattern (0/1/2 dots, 3 horizontal lines, 4 vertical lines) and
 *  `seed` (u32) seeds the threshold hash. Output is pure 0 / 65535. Does not mutate the input. */
export function mezzotint2D(
  image: readonly (readonly number[])[],
  kind: number,
  seed: number,
  channel = 0,
): number[][] {
  const h = image.length;
  const w = h > 0 ? image[0].length : 0;
  if (w === 0) return image.map((row) => [...row]);
  const block = mezzotintBlock(kind);
  return image.map((row, y) =>
    row.map((v, x) => {
      const bx = kind === 3 ? 0 : kind === 4 ? x : Math.floor(x / block);
      const by = kind === 3 ? y : kind === 4 ? 0 : Math.floor(y / block);
      const val = fr(v / 65535);
      return val >= mezzotintHash(bx, by, channel, seed) ? MEZZOTINT_MAX : 0;
    }),
  );
}
