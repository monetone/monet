// Automatic dust-spot detection (Camera Raw "Detect Spots"). Sensor/lens dust
// and blemishes are small local anomalies: pixels whose luminance deviates
// strongly from a local average. This finds those local maxima of deviation,
// non-max-suppresses them into distinct blobs, and returns the top ones as
// normalized centres so the develop workspace can seed healing spots. It pairs
// with Visualize Spots (which makes the same anomalies visible). Deterministic
// + engine-free so it unit-tests in node. (ponytail: a plain deviation-from-blur
// detector, not a learned model — good enough to seed spots the user refines.)

export interface DetectedSpot {
  /** Centre + radius, normalized to the source (0..1). */
  x: number;
  y: number;
  radius: number;
}

export interface DetectDustOptions {
  /** 0..1; higher finds fainter spots (lower deviation threshold). */
  sensitivity?: number;
  maxSpots?: number;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Box-blur a luminance plane (naive; the radius is small and this runs once
 *  per Detect click). */
function boxBlur(lum: Float32Array, w: number, h: number, r: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let cnt = 0;
      for (let dy = -r; dy <= r; dy++) {
        const yy = Math.min(h - 1, Math.max(0, y + dy));
        for (let dx = -r; dx <= r; dx++) {
          const xx = Math.min(w - 1, Math.max(0, x + dx));
          sum += lum[yy * w + xx];
          cnt++;
        }
      }
      out[y * w + x] = sum / cnt;
    }
  }
  return out;
}

/** Detect dust/blemish spots in an RGBA image. Returns normalized centres,
 *  brightest-deviation first, at least `2.5·radius` apart. */
export function detectDustSpots(
  src: Uint8ClampedArray | Uint8Array,
  w: number,
  h: number,
  opts: DetectDustOptions = {},
): DetectedSpot[] {
  if (w < 3 || h < 3) return [];
  const sensitivity = clamp01(opts.sensitivity ?? 0.5);
  const maxSpots = opts.maxSpots ?? 32;

  const n = w * h;
  const lum = new Float32Array(n);
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    lum[p] = 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2];
  }
  const r = Math.max(2, Math.round(Math.min(w, h) * 0.02));
  const mean = boxBlur(lum, w, h, r);

  const dev = new Float32Array(n);
  let sum = 0;
  let sum2 = 0;
  for (let p = 0; p < n; p++) {
    const d = Math.abs(lum[p] - mean[p]);
    dev[p] = d;
    sum += d;
    sum2 += d * d;
  }
  const m = sum / n;
  const sd = Math.sqrt(Math.max(0, sum2 / n - m * m));
  // Higher sensitivity → lower σ multiplier → fainter spots pass.
  const thr = m + (4 - sensitivity * 3) * sd;

  const cands: { p: number; d: number }[] = [];
  for (let p = 0; p < n; p++) if (dev[p] > thr) cands.push({ p, d: dev[p] });
  cands.sort((a, b) => b.d - a.d);

  const minDist2 = (r * 2.5) ** 2;
  const chosen: { x: number; y: number }[] = [];
  const spots: DetectedSpot[] = [];
  for (const c of cands) {
    if (spots.length >= maxSpots) break;
    const x = c.p % w;
    const y = (c.p / w) | 0;
    if (chosen.some((s) => (s.x - x) ** 2 + (s.y - y) ** 2 < minDist2)) continue;
    chosen.push({ x, y });
    spots.push({ x: (x + 0.5) / w, y: (y + 0.5) / h, radius: (r * 1.5) / Math.min(w, h) });
  }
  return spots;
}

/** Pick a healing SOURCE offset for a detected spot: a nearby point pulled
 *  toward the image centre (usually cleaner background), clamped in-bounds.
 *  Image-blind — the fallback for when no pixels are at hand; prefer
 *  `pickHealSource`. */
export function healSourceFor(spot: DetectedSpot): { sourceX: number; sourceY: number } {
  const off = Math.max(spot.radius * 3, 0.06);
  const dirX = spot.x < 0.5 ? 1 : -1;
  const dirY = spot.y < 0.5 ? 1 : -1;
  return {
    sourceX: clamp01(spot.x + dirX * off),
    sourceY: clamp01(spot.y + dirY * off),
  };
}

export interface HealSourceOptions {
  /** Discs (normalized, like a spot) the source must not overlap — the other
   *  spots, so a blemish never heals with another blemish. */
  avoid?: readonly DetectedSpot[];
  /** 0 = best match; higher walks down the ranked candidates, so the UI's `/`
   *  can refresh to the next-best source. Wraps. */
  rank?: number;
}

/** Candidate source centres: rings at these multiples of the spot radius (the
 *  innermost already clears the target disc), sampled at 16 angles each. */
const SOURCE_RINGS = [2, 3, 4, 5.5, 7];
const SOURCE_ANGLES = 16;

/** Pick a healing SOURCE for `spot` by looking at the pixels: score a bounded
 *  ring of nearby candidate discs by how closely the context AROUND them matches
 *  the context around the target, and take the best. The blemish itself is
 *  excluded from the comparison (only the annulus outside `radius` is scored),
 *  so the defect doesn't bias every candidate equally. Deterministic; falls back
 *  to `healSourceFor` when nothing fits inside the frame.
 *  (ponytail: SSD over a subsampled annulus against a fixed candidate ring, not
 *  a PatchMatch search — widen SOURCE_RINGS or switch to NCC if matches on
 *  strongly-shaded backgrounds disappoint.) */
export function pickHealSource(
  src: Uint8ClampedArray | Uint8Array,
  w: number,
  h: number,
  spot: DetectedSpot,
  opts: HealSourceOptions = {},
): { sourceX: number; sourceY: number } {
  if (w < 3 || h < 3) return healSourceFor(spot);
  const minDim = Math.min(w, h);
  const rPx = Math.max(1, Math.round(spot.radius * minDim));
  const tx = Math.round(spot.x * w);
  const ty = Math.round(spot.y * h);
  const lumAt = (x: number, y: number): number => {
    const i = (Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 4;
    return 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2];
  };

  // The context annulus, as flat dx,dy pairs, subsampled so a big proxy spot
  // costs the same as a small one.
  const outer = Math.max(2, Math.round(rPx * 1.6));
  const step = Math.max(1, Math.floor((outer * 2 + 1) / 9));
  const offs: number[] = [];
  for (let dy = -outer; dy <= outer; dy += step) {
    for (let dx = -outer; dx <= outer; dx += step) {
      const d2 = dx * dx + dy * dy;
      if (d2 > rPx * rPx && d2 <= outer * outer) offs.push(dx, dy);
    }
  }
  if (offs.length === 0) return healSourceFor(spot);
  const ref = new Float32Array(offs.length / 2);
  for (let k = 0; k < ref.length; k++) ref[k] = lumAt(tx + offs[k * 2], ty + offs[k * 2 + 1]);

  const avoid = opts.avoid ?? [];
  const scored: { x: number; y: number; score: number }[] = [];
  for (const mult of SOURCE_RINGS) {
    const dist = rPx * mult;
    for (let a = 0; a < SOURCE_ANGLES; a++) {
      const th = (a / SOURCE_ANGLES) * Math.PI * 2;
      const cx = Math.round(tx + Math.cos(th) * dist);
      const cy = Math.round(ty + Math.sin(th) * dist);
      // The whole source disc must sit inside the frame — a clipped one samples
      // repeated edge pixels and scores deceptively flat.
      if (cx - rPx < 0 || cy - rPx < 0 || cx + rPx >= w || cy + rPx >= h) continue;
      if (
        avoid.some(
          (s) =>
            Math.hypot(cx - s.x * w, cy - s.y * h) <
            rPx + Math.max(1, Math.round(s.radius * minDim)),
        )
      )
        continue;
      let sum = 0;
      for (let k = 0; k < ref.length; k++) {
        const d = ref[k] - lumAt(cx + offs[k * 2], cy + offs[k * 2 + 1]);
        sum += d * d;
      }
      scored.push({ x: cx, y: cy, score: sum });
    }
  }
  if (scored.length === 0) return healSourceFor(spot);
  // Stable sort: equal scores keep ring/angle order, so the pick is repeatable.
  scored.sort((a, b) => a.score - b.score);
  const rank = Math.max(0, Math.round(opts.rank ?? 0)) % scored.length;
  const best = scored[rank];
  return { sourceX: clamp01((best.x + 0.5) / w), sourceY: clamp01((best.y + 0.5) / h) };
}
