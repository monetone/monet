// ─────────────────────────────────────────────────────────────
// Facet (Filter ▸ Pixelate ▸ Facet) — clumps blocks of similarly-coloured pixels into solid
// facets, giving a hand-painted / posterised look. For each pixel it looks at the 3×3
// neighbourhood, groups the 9 samples into coarse colour buckets, and replaces the pixel
// with the AVERAGE colour of the most-populous bucket. Integer-only and deterministic (no
// RNG, no f32). Engine-free so it unit-tests in node.
//
// The engine's bucket key is built from all three channels (top 5 bits each), so it couples
// R/G/B — this reference models a single LUMINANCE channel: it treats each value v as a grey
// pixel R=G=B=v, for which the key collapses to `v >> 11` (the top 5 bits, i.e. which of the
// 32 bands of width 2048 the value falls in). On a grey (R=G=B) image that yields exactly the
// same bucket partition the engine forms for every channel, so this matches `facet`'s output
// bit-for-bit; on colour input the engine's key would also weigh the other channels.
//
// MUST match `filters.rs facet` (grey domain):
//   for each pixel, over the 3×3 edge-clamped neighbourhood (`idx` clamps x,y to the image):
//     key = v >> 11;  bucket per key, summing v and counting members (insertion order = the
//     row-major dy=−1..1, dx=−1..1 scan)
//   pick the bucket with the most members; ON A TIE the LAST such bucket in insertion order
//     wins (Rust `Iterator::max_by_key` returns the last maximum)
//   out = floor(sum / count)   (u64 integer division, truncating)
//
// A flat 3×3 is one bucket ⇒ the pixel is unchanged. Mirrors the `medianFilter.ts` house
// style (neighbourhood, edge-clamped, integer-exact — but a modal-bucket mean, not a median).
// ─────────────────────────────────────────────────────────────

/** The engine works in 16-bit; channel values span [0, 65535]. */
export const FACET_MAX = 65535;

/** Clamp an index to `[0, hi]` — the engine's edge-replicate border (`idx`). */
const clampIdx = (v: number, hi: number): number => (v < 0 ? 0 : v > hi ? hi : v);

/** The dominant 3×3 bucket for pixel `(x, y)`: its coarse `key` (= v>>11), member `count`,
 *  and the facet output `value` (floor of the bucket's mean). Exposed so the bucketing and
 *  tie-break are unit-testable independently of the full-image pass. Precondition: `image`
 *  is non-empty and `(x, y)` in bounds (`facet2D` guarantees this). */
export function facetPixel(
  image: readonly (readonly number[])[],
  x: number,
  y: number,
): { key: number; count: number; value: number } {
  const h = image.length;
  const w = image[0].length;
  const keys: number[] = []; // distinct bucket keys, in row-major insertion order
  const sums: number[] = [];
  const counts: number[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const v = image[clampIdx(y + dy, h - 1)][clampIdx(x + dx, w - 1)];
      const key = v >> 11; // top 5 bits — the engine's per-channel bucket key on grey input
      const bi = keys.indexOf(key);
      if (bi === -1) {
        keys.push(key);
        sums.push(v);
        counts.push(1);
      } else {
        sums[bi] += v;
        counts[bi] += 1;
      }
    }
  }
  // most-populous bucket; `>=` so a later equal-count bucket replaces the earlier one,
  // matching Rust `max_by_key` (the LAST maximum is returned).
  let best = 0;
  for (let i = 1; i < counts.length; i++) if (counts[i] >= counts[best]) best = i;
  return { key: keys[best], count: counts[best], value: Math.floor(sums[best] / counts[best]) };
}

/** Apply Facet to a single-channel (luminance) 2-D image (u16 values 0..65535). */
export function facet2D(image: readonly (readonly number[])[]): number[][] {
  const h = image.length;
  const w = h > 0 ? image[0].length : 0;
  const out = image.map((row) => [...row]);
  if (w === 0) return out;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out[y][x] = facetPixel(image, x, y).value;
    }
  }
  return out;
}
