// ─────────────────────────────────────────────────────────────
// Defringe (Layer ▸ Matting ▸ Defringe) — removes the coloured halo (the "fringe") left around a
// layer's antialiased edge by replacing each fringe pixel's colour with the average of its OPAQUE
// INTERIOR neighbours. Like Remove Matte it is ALPHA-DEPENDENT, but spatial: it reads an 8-pixel
// neighbourhood. Deterministic; engine-free so it unit-tests in node.
//
// A pixel is a FRINGE pixel when it is opaque (alpha > 0) yet has at least one 4-neighbour that is
// fully transparent (alpha == 0) — out-of-bounds counts as transparent, so the image border ring
// of a fully-opaque layer is fringe too. Each RGB channel is averaged independently with the same
// neighbour set, so a grey image (R=G=B) is modelled here as one value channel plus an alpha mask.
//
// MUST match `filters.rs defringe` (full selection ⇒ cov 1; alpha never modified):
//   is_fringe(x,y) = α(x,y) > 0 ∧ (α(x-1,y)=0 ∨ α(x+1,y)=0 ∨ α(x,y-1)=0 ∨ α(x,y+1)=0)
//   repeat max(width,1) passes; per pass over a snapshot: for each fringe pixel,
//     average the value of the 8-neighbours that are opaque AND non-fringe (n of them),
//     and if n>0 set value = round(Σ/n); otherwise leave it.
//
// Because `is_fringe` is determined purely by ALPHA (which defringe never changes) and the
// averaged neighbours are always NON-fringe (whose value never changes), every pass after the
// first reproduces the first — so width is effectively a single pass (the mirror still loops to
// stay faithful). Fully bit-exact: Σ of ≤8 u16 values is < 2²⁴ (exact in f32), and division is
// IEEE-correctly-rounded; the `.round()` is half-away. `Math.fround` keeps the f32 accumulator.
// ─────────────────────────────────────────────────────────────

const fr = Math.fround;
/** The engine works in 16-bit; channel values span [0, 65535]. */
export const DEFRINGE_MAX = 65535;

/** f32 `round()` — nearest integer, halves away from zero. All averages here are ≥ 0. */
const roundHalfAway = (x: number): number => (x < 0 ? -Math.round(-x) : Math.round(x));

/** The 8-neighbour offsets in the engine's iteration order. */
const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1],
];

/** Alpha at `(x, y)`, with out-of-bounds reading as 0 (fully transparent), matching the engine. */
function alphaAt(alpha: readonly (readonly number[])[], x: number, y: number, w: number, h: number): number {
  return x < 0 || y < 0 || x >= w || y >= h ? 0 : alpha[y][x];
}

/** Whether `(x, y)` is a fringe pixel: opaque, but touching transparency on a 4-neighbour (or the
 *  image border). Depends only on the alpha mask. Exposed for testing. */
export function isFringe(alpha: readonly (readonly number[])[], x: number, y: number): boolean {
  const h = alpha.length;
  const w = h > 0 ? alpha[0].length : 0;
  if (alphaAt(alpha, x, y, w, h) <= 0) return false;
  return (
    alphaAt(alpha, x - 1, y, w, h) === 0 ||
    alphaAt(alpha, x + 1, y, w, h) === 0 ||
    alphaAt(alpha, x, y - 1, w, h) === 0 ||
    alphaAt(alpha, x, y + 1, w, h) === 0
  );
}

/** Apply Defringe to a single-channel (grey) value image with a matching alpha mask (both u16
 *  grids of the same shape). Returns the new value grid; the alpha mask is unchanged. `width` is
 *  the pass count (≥1) — but the result is identical for any width (see the file header). Does not
 *  mutate the inputs. */
export function defringe2D(
  value: readonly (readonly number[])[],
  alpha: readonly (readonly number[])[],
  width: number,
): number[][] {
  const h = value.length;
  const w = h > 0 ? value[0].length : 0;
  const buf = value.map((row) => [...row]);
  if (w === 0) return buf;
  const passes = Math.max(Math.trunc(width), 1);
  for (let p = 0; p < passes; p++) {
    const src = buf.map((row) => [...row]); // snapshot at the start of the pass
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!isFringe(alpha, x, y)) continue;
        let acc = 0;
        let n = 0;
        for (const [dx, dy] of NEIGHBOURS) {
          const nx = x + dx;
          const ny = y + dy;
          if (alphaAt(alpha, nx, ny, w, h) > 0 && !isFringe(alpha, nx, ny)) {
            acc = fr(acc + src[ny][nx]); // exact (Σ of ≤8 u16 < 2²⁴)
            n += 1;
          }
        }
        if (n > 0) buf[y][x] = roundHalfAway(fr(acc / n));
      }
    }
  }
  return buf;
}
