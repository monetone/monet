// ─────────────────────────────────────────────────────────────
// Equalize (Image ▸ Adjustments ▸ Equalize) — redistribute tones so the image uses
// the full luminance range with a roughly flat histogram, maximising global contrast.
// Engine-free so it unit-tests in node.
//
// MUST match `adjust.rs equalize`:
//   1. Build a 256-bin histogram of each pixel's Rec.601 luminance
//      `l = 0.299r + 0.587g + 0.114b` (computed in f32), bin = `(l·255 + 0.5) as usize`
//      capped at 255, weighted by selection coverage.
//   2. Build the LUT with the standard min-normalised CDF:
//      `cdf_min` = the count in the lowest occupied bin, `denom = max(total − cdf_min, 1e-9)`,
//      `lut[i] = clamp01((cdf_i − cdf_min) / denom)` (stored as f32).
//   3. Per pixel, recompute `l`, and shift EVERY channel by the same luminance delta
//      `delta = lut[bin(l)] − l` (so colour/hue is preserved; only brightness moves),
//      clamping each channel to [0,1].
//
// For a single grayscale channel (r = g = b = l) the apply step collapses to
// `out = clamp01(l + (lut[bin] − l)) = lut[bin]`, i.e. a direct value→lut remap — the
// exact, fully-testable core. The histogram binning is a hard floor decision, so the
// luminance is computed in f32 (`Math.fround`) to land in the same bin as the engine.
//
// 8-bit reference: `byte()` rounds half-up (Photoshop semantics). The engine carries
// values at u16 and its `u16_to_8` readback truncates (`>>8`), so its 8-bit output can
// differ from this round-half-up reference by ≤1 LSB. Mirrors the `posterize.ts` /
// `threshold.ts` state-module house style (f32-faithful hard decisions).
// ─────────────────────────────────────────────────────────────

const clamp01 = (n: number): number => (n <= 0 ? 0 : n >= 1 ? 1 : n);
const f = Math.fround;
/** Round a normalised 0..1 value to an 8-bit integer (round-half-up). */
const byte = (n: number): number => Math.round(clamp01(n) * 255);

// Rec.601 coefficients as f32 literals, matching the engine's f32 arithmetic.
const C_R = Math.fround(0.299);
const C_G = Math.fround(0.587);
const C_B = Math.fround(0.114);

/** Rec.601 luminance of normalised 0..1 channels, evaluated in f32 (same op order as
 *  the engine: `((Cr·r + Cg·g) + Cb·b)`) so binning decisions match bit-for-bit. */
export function luminance601(r: number, g: number, b: number): number {
  return f(f(f(C_R * f(r)) + f(C_G * f(g))) + f(C_B * f(b)));
}

/** The 0..255 histogram bin for a luminance value: `(clamp01(l)·255 + 0.5)` truncated
 *  (engine `as usize`) and capped at 255. Round-half-up at bin boundaries. */
export function binIndex(l: number): number {
  const scaled = f(f(f(clamp01(l)) * 255) + 0.5);
  const bin = Math.floor(scaled); // `as usize` truncates toward zero; scaled ≥ 0
  return bin < 255 ? bin : 255;
}

/** Build the 256-entry equalization LUT (values 0..1) from a 256-bin coverage-weighted
 *  histogram. Returns `null` when the histogram is empty (the engine no-ops). Uses the
 *  standard min-normalised CDF: subtract the lowest occupied bin's count so the darkest
 *  present tone maps to 0 and the brightest to 1. */
export function equalizeLut(hist: readonly number[]): number[] | null {
  let total = 0;
  let cdfMin = 0;
  let foundMin = false;
  for (let i = 0; i < 256; i++) {
    const h = hist[i] ?? 0;
    total += h;
    if (!foundMin && h > 0) {
      cdfMin = h;
      foundMin = true;
    }
  }
  if (total <= 0) return null;
  const denom = Math.max(total - cdfMin, 1e-9);
  const lut = new Array<number>(256);
  let cdf = 0;
  for (let i = 0; i < 256; i++) {
    cdf += hist[i] ?? 0;
    lut[i] = f(clamp01((cdf - cdfMin) / denom));
  }
  return lut;
}

/** Equalize a single grayscale channel (values 0..255 ints): bin → LUT → remap. An
 *  empty input is returned unchanged (engine no-op); a constant image collapses to 0
 *  (its single histogram spike becomes `cdf_min`, leaving zero range to stretch — the
 *  engine's documented degenerate result). Run per-luminance to drive an RGB image. */
export function equalizeGray(values: readonly number[]): number[] {
  const hist = new Array<number>(256).fill(0);
  for (const v of values) hist[binIndex(f(v / 255))] += 1;
  const lut = equalizeLut(hist);
  if (lut === null) return values.map((v) => v);
  return values.map((v) => byte(lut[binIndex(f(v / 255))]));
}

/** The luminance delta the engine adds to every channel of a colour pixel:
 *  `lut[bin(l)] − l` (preserves hue; only shifts brightness). Inputs are 0..1. */
export function equalizeDelta(
  lut: readonly number[],
  r: number,
  g: number,
  b: number,
): number {
  const l = clamp01(luminance601(r, g, b));
  return lut[binIndex(l)] - l;
}
