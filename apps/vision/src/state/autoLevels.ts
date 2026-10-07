// ─────────────────────────────────────────────────────────────
// Auto Tone / Auto Contrast (Image ▸ Auto Tone / Auto Contrast) — histogram-based
// contrast stretch. Finds each channel's black/white points by ignoring a small
// fraction of outlier pixels at each end of the histogram, then linearly stretches
// that range to [0,255].
//
// Engine-free so it unit-tests in node. MUST match `mod.rs auto_stretch` /
// `hist_bounds`: Auto Tone stretches each channel independently (its own
// histogram); Auto Contrast uses one combined RGB histogram applied to all three
// channels (preserving colour balance). The stretch uses INTEGER division, exactly
// like the engine. The computed `{lo, hi}` are also the input black/white points
// for Levels — see `levelsChannels.ts`.
//
// Two deliberate deviations from the engine (this is an opaque-pixel reference):
//   • the engine only histograms pixels with alpha > 0; the `Rgb` API here has no
//     alpha, so every pixel is counted (results match for fully-opaque images);
//   • `clip = floor(total · 0.001)` is computed in f64 here; the engine uses f32,
//     which for images over ~16.7M samples (large Auto Contrast totals) can shift a
//     bound by at most one bin. Both are sub-perceptual and documented for parity.
// ─────────────────────────────────────────────────────────────

/** Photoshop's default 0.1% clip at each end of the histogram. */
export const CLIP_FRAC = 0.001;

export interface Bounds {
  lo: number;
  hi: number;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Black/white points from a 256-bin histogram, ignoring `clipFrac` of the samples
 *  at each end. Exact mirror of `mod.rs hist_bounds`: `lo`/`hi` are the first bins
 *  (from the bottom / top) whose running count *exceeds* the clip count. An empty
 *  histogram yields the full range. */
export function histBounds(hist: readonly number[], clipFrac = CLIP_FRAC): Bounds {
  return histBoundsAsym(hist, clipFrac, clipFrac);
}

/** `histBounds` with separate shadow/highlight clips — Photoshop's Auto Color
 *  Correction Options let the two ends differ (#436). */
export function histBoundsAsym(hist: readonly number[], shadowFrac: number, highlightFrac: number): Bounds {
  let total = 0;
  for (const h of hist) total += h;
  if (total === 0) return { lo: 0, hi: 255 };
  const clipLo = Math.floor(total * shadowFrac);
  const clipHi = Math.floor(total * highlightFrac);
  let lo = 0;
  let acc = 0;
  for (let b = 0; b < 256; b++) {
    acc += hist[b] ?? 0;
    if (acc > clipLo) {
      lo = b;
      break;
    }
  }
  let hi = 255;
  let acc2 = 0;
  for (let b = 255; b >= 0; b--) {
    acc2 += hist[b] ?? 0;
    if (acc2 > clipHi) {
      hi = b;
      break;
    }
  }
  return { lo, hi };
}

/** Linearly stretch one 8-bit value from `[lo,hi]` to `[0,255]` with the engine's
 *  integer division (truncating). `hi ≤ lo` leaves the value unchanged. */
export function autoStretchValue(v: number, lo: number, hi: number): number {
  if (hi <= lo) return v;
  const nv = Math.trunc(((v - lo) * 255) / (hi - lo));
  return nv < 0 ? 0 : nv > 255 ? 255 : nv;
}

// Build a 256-bin histogram for one channel selector over a pixel set.
function histOf(pixels: readonly Rgb[], pick: (p: Rgb) => number): number[] {
  const h = new Array<number>(256).fill(0);
  for (const p of pixels) h[pick(p)]++;
  return h;
}

/** Per-channel black/white points (Auto Tone): each channel from its own histogram. */
export function autoToneRanges(pixels: readonly Rgb[], clipFrac = CLIP_FRAC): [Bounds, Bounds, Bounds] {
  return [
    histBounds(histOf(pixels, (p) => p.r), clipFrac),
    histBounds(histOf(pixels, (p) => p.g), clipFrac),
    histBounds(histOf(pixels, (p) => p.b), clipFrac),
  ];
}

/** One black/white point (Auto Contrast): a single histogram over all three
 *  channels combined, applied to every channel — preserves colour balance. */
export function autoContrastRange(pixels: readonly Rgb[], clipFrac = CLIP_FRAC): Bounds {
  const h = new Array<number>(256).fill(0);
  for (const p of pixels) {
    h[p.r]++;
    h[p.g]++;
    h[p.b]++;
  }
  return histBounds(h, clipFrac);
}

/** Apply Auto Tone (`perChannel = true`) or Auto Contrast (`perChannel = false`) to
 *  a pixel set, exactly as the engine does. If every channel's range is flat the
 *  pixels are returned unchanged (the engine aborts). */
export function autoStretch(pixels: readonly Rgb[], perChannel: boolean, clipFrac = CLIP_FRAC): Rgb[] {
  const ranges: [Bounds, Bounds, Bounds] = perChannel
    ? autoToneRanges(pixels, clipFrac)
    : ((g) => [g, g, g] as [Bounds, Bounds, Bounds])(autoContrastRange(pixels, clipFrac));
  if (ranges.every((r) => r.hi <= r.lo)) return pixels.map((p) => ({ ...p }));
  return pixels.map((p) => ({
    r: autoStretchValue(p.r, ranges[0].lo, ranges[0].hi),
    g: autoStretchValue(p.g, ranges[1].lo, ranges[1].hi),
    b: autoStretchValue(p.b, ranges[2].lo, ranges[2].hi),
  }));
}

const clamp = (n: number, lo: number, hi: number): number => (n < lo ? lo : n > hi ? hi : n);
const clamp01 = (n: number): number => (n <= 0 ? 0 : n >= 1 ? 1 : n);
// The engine clamps each channel's mean/target to this range before taking logs so
// the per-channel gamma stays finite (no log(0)).
const GAMMA_FLOOR = 0.004;
const GAMMA_CEIL = 0.996;

/** Apply Auto Color (Image ▸ Auto Color) to a pixel set, exactly as the engine
 *  does: a per-channel contrast stretch (like Auto Tone) followed by a midtone
 *  neutralization — a per-channel gamma that maps each channel's mean toward the
 *  average gray, removing the colour cast Auto Tone can introduce. Endpoints (0,
 *  255) are gamma-fixed, so the full-range stretch is preserved. The gamma runs in
 *  f64 like the engine; `Math.log`/`Math.pow` vs Rust `ln`/`powf` could differ by
 *  ≤1 ULP at a knife-edge value (sub-perceptual), as with the f32/f64 clip note. */
export function autoColor(pixels: readonly Rgb[], clipFrac = CLIP_FRAC): Rgb[] {
  const ranges = autoToneRanges(pixels, clipFrac);
  if (ranges.every((r) => r.hi <= r.lo)) return pixels.map((p) => ({ ...p }));
  // 1) per-channel contrast stretch (8-bit, truncating like the engine)
  const stretched = pixels.map((p) => ({
    r: autoStretchValue(p.r, ranges[0].lo, ranges[0].hi),
    g: autoStretchValue(p.g, ranges[1].lo, ranges[1].hi),
    b: autoStretchValue(p.b, ranges[2].lo, ranges[2].hi),
  }));
  const count = stretched.length;
  if (count === 0) return stretched;
  // 2) midtone neutralization — per-channel mean of the *stretched* pixels (0..1).
  let mr = 0;
  let mg = 0;
  let mb = 0;
  for (const p of stretched) {
    mr += p.r;
    mg += p.g;
    mb += p.b;
  }
  const means = [mr / (count * 255), mg / (count * 255), mb / (count * 255)];
  const target = clamp((means[0] + means[1] + means[2]) / 3, GAMMA_FLOOR, GAMMA_CEIL);
  // inv_gamma[c] solves `mean_c ^ inv_gamma == target`, i.e. the gamma that maps the
  // channel mean to the neutral target.
  const invGamma = means.map((m) => Math.log(target) / Math.log(clamp(m, GAMMA_FLOOR, GAMMA_CEIL)));
  const ch = (v: number, ig: number) => {
    const nv = Math.round(Math.pow(clamp01(v / 255), ig) * 255);
    return nv < 0 ? 0 : nv > 255 ? 255 : nv;
  };
  return stretched.map((p) => ({ r: ch(p.r, invGamma[0]), g: ch(p.g, invGamma[1]), b: ch(p.b, invGamma[2]) }));
}
