// Camera Raw "Auto" (Basic panel). One click computes tone adjustments that
// balance the image: it reads the preview's luminance percentiles and derives
// Exposure (push the median toward a mid target), Whites/Blacks (stretch the
// endpoints toward clipping), and Shadows/Highlights (lift dark / recover bright)
// plus a mild Contrast. Deterministic + engine-free so it unit-tests in node.
// (ponytail: a percentile heuristic, not ACR's adaptive model — a good one-click
// starting point the user refines. Values are in recipe units: exposure in EV,
// the rest -1..1.)
import type { CameraRawBasic } from "./cameraRaw";

export type AutoBasic = Pick<
  CameraRawBasic,
  "exposure" | "contrast" | "highlights" | "shadows" | "whites" | "blacks"
>;

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);

/** Compute auto tone adjustments from an RGBA preview. */
export function autoDevelopBasic(src: Uint8ClampedArray | Uint8Array, w: number, h: number): AutoBasic {
  const n = w * h;
  if (n === 0) return { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 };
  const hist = new Array(256).fill(0);
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const lum = 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2];
    hist[Math.min(255, Math.max(0, Math.round(lum)))]++;
  }
  const pct = (q: number): number => {
    const target = n * q;
    let c = 0;
    for (let i = 0; i < 256; i++) {
      c += hist[i];
      if (c >= target) return i / 255;
    }
    return 1;
  };
  const lo = pct(0.01);
  const median = pct(0.5);
  const hi = pct(0.99);

  // Exposure (EV): push the median toward a mid target.
  const exposure = clamp(Math.log2(0.45 / Math.max(0.02, median)), -2, 2);
  // Shadows lift a dark image; Highlights recover a bright one.
  const shadows = clamp((0.3 - median) * 1.2, -1, 1);
  const highlights = clamp((0.7 - median) * 1.2, -1, 1);
  const contrast = 0.15;
  // Whites/Blacks: stretch the endpoints toward 0 and 1. The engine applies them
  // AFTER exposure/contrast/highlights/shadows (develop.rs), so they must be
  // derived from where the percentiles LAND, not from the untouched histogram
  // (#150) — the old pre-exposure derivation double-counted Auto's own exposure
  // push and flattened ~45% of an underexposed frame to pure white. `toned`
  // mirrors adjust::camera_raw's neutral-grey tone path (it clamps to [0,1]).
  const toned = (v: number): number => {
    const t = (v * 2 ** exposure - 0.5) * (1 + contrast) + 0.5;
    const hw = clamp(t * 2 - 1, 0, 1); // 0 mid → 1 white
    const sw = clamp(1 - t * 2, 0, 1); // 1 black → 0 mid
    return clamp(t + highlights * hw * 0.5 + shadows * sw * 0.5, 0, 1);
  };
  const toneLo = toned(lo);
  const span = toned(hi) - toneLo;
  // Nothing to stretch on a (near-)flat histogram — any endpoint move there just
  // binarizes the frame.
  if (span < 0.02) return { exposure, contrast, highlights, shadows, whites: 0, blacks: 0 };
  // Place the endpoints so the toned 1st/99th percentiles land on 0.01/0.99.
  // adjust::whites_blacks maps [-blacks*0.5, 1-whites*0.5] onto [0,1].
  const inv = span / 0.98; // the input span that spreads over 0.01..0.99
  const blackPt = toneLo - 0.01 * inv;
  const whites = clamp((1 - blackPt - inv) * 2, -1, 1);
  const blacks = clamp(-2 * blackPt, -1, 1);
  return { exposure, contrast, highlights, shadows, whites, blacks };
}
