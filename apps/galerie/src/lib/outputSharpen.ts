// outputSharpen — Lightroom Classic "Output Sharpening" for raster exports.
//
// LR sharpens the final output for the destination medium: Sharpen For
// (Screen / Matte Paper / Glossy Paper) × Amount (Low / Standard / High).
// Paper media get more sharpening than screen to offset ink/paper softening.
//
// Pure: an unsharp-mask on luminance detail (no hue shift), applied at output
// resolution by the export encoder.

export type SharpenMedia = "screen" | "matte" | "glossy";
export type SharpenAmount = "low" | "standard" | "high";
export interface SharpenSpec {
  media: SharpenMedia;
  amount: SharpenAmount;
}
export interface SharpenParams {
  /** USM gain applied to the (detail = image − blur) signal. */
  amount: number;
  /** Box-blur radius in px (larger = coarser detail band). */
  radius: number;
  /** Ignore detail below this magnitude (avoids amplifying noise on paper). */
  threshold: number;
}

const AMOUNT: Record<SharpenAmount, number> = { low: 0.35, standard: 0.7, high: 1.1 };
// ponytail: radius is in output pixels with no ppi/print-size adaptation, and
// only the JPEG/PNG export route is sharpened (the native 16-bit TIFF/DNG route
// isn't). Both are known divergences from LR's resolution-adaptive print
// sharpening — revisit if print-lab parity is required (needs a ppi input + a
// USM pass in the Rust develop-export pipeline).
const MEDIA: Record<SharpenMedia, { radius: number; amountMul: number; threshold: number }> = {
  screen: { radius: 1, amountMul: 1.0, threshold: 0 },
  glossy: { radius: 1, amountMul: 1.2, threshold: 2 },
  matte: { radius: 2, amountMul: 1.4, threshold: 3 },
};

export function sharpenParams(spec: SharpenSpec): SharpenParams {
  const m = MEDIA[spec.media];
  return { amount: AMOUNT[spec.amount] * m.amountMul, radius: m.radius, threshold: m.threshold };
}

/** Rec.601 luma of an 8-bit RGB triple. */
function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Separable box blur of a scalar field, window (2r+1), edge-clamped. */
function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  if (r < 1) return src.slice();
  const win = 2 * r + 1;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += src[row + Math.min(w - 1, Math.max(0, x + k))];
      tmp[row + x] = sum / win;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += tmp[Math.min(h - 1, Math.max(0, y + k)) * w + x];
      out[y * w + x] = sum / win;
    }
  }
  return out;
}

/** Unsharp-mask on luminance detail: sharpens edges without shifting hue.
 *  Pure — returns a new Uint8ClampedArray; alpha and sub-threshold pixels are
 *  passed through unchanged. */
export function unsharpMask(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  params: SharpenParams,
): Uint8ClampedArray {
  const n = width * height;
  const out = new Uint8ClampedArray(rgba.length);
  out.set(rgba);
  if (params.amount <= 0) return out;

  const L = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    L[i] = luma(rgba[j], rgba[j + 1], rgba[j + 2]);
  }
  const blur = boxBlur(L, width, height, params.radius);
  const { amount, threshold } = params;
  for (let i = 0; i < n; i++) {
    let delta = L[i] - blur[i];
    if (Math.abs(delta) <= threshold) continue;
    delta *= amount;
    const j = i * 4;
    out[j] = rgba[j] + delta; // Uint8ClampedArray clamps + rounds
    out[j + 1] = rgba[j + 1] + delta;
    out[j + 2] = rgba[j + 2] + delta;
  }
  return out;
}
