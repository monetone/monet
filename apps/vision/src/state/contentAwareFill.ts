// Content-Aware Fill workspace — pure helpers (engine-free, so vitest can run
// them in node). The synthesis lives in the engine
// (raster/mod.rs::content_aware_fill_workspace); this module builds the
// Sampling Area presets and the green overlay the workspace draws over its
// preview. The brush reuses selectAndMask.ts::stampSamBrush.

export type SamplingMode = "auto" | "rectangular" | "custom";

export interface ContentAwareFillOptions {
  /** Document-sized sampling mask: above 127 = the fill may copy from here. */
  sample: Uint8Array;
  /** Color Adaptation: 0 None · 1 Default · 2 High · 3 Very High. */
  color: number;
  /** Rotation Adaptation: 0 None · 1 Low · 2 Medium · 3 High · 4 Full. */
  rotation: number;
  scale: boolean;
  mirror: boolean;
  /** Output To: 0 Current Layer · 1 New Layer · 2 Duplicate Layer. */
  output: number;
}

/** The sampling mask a Sampling Area preset starts from. `sel` is the
 *  document's selection mask (0..255), and the hole it covers is never
 *  sampled. Auto samples everything else, Rectangular the selection's
 *  bounding box grown by half its longer side, Custom nothing until painted. */
export function samplingPreset(mode: SamplingMode, sel: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  let [x0, y0, x1, y1] = [0, 0, w - 1, h - 1];
  if (mode === "custom") return out;
  if (mode === "rectangular") {
    [x0, y0, x1, y1] = [w, h, -1, -1];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (sel[y * w + x] <= 127) continue;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x);
        y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
    }
    if (x1 < 0) return out;
    const grow = Math.ceil(Math.max(x1 - x0 + 1, y1 - y0 + 1) / 2);
    [x0, y0, x1, y1] = [Math.max(0, x0 - grow), Math.max(0, y0 - grow), Math.min(w - 1, x1 + grow), Math.min(h - 1, y1 + grow)];
  }
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) if (sel[y * w + x] <= 127) out[y * w + x] = 255;
  }
  return out;
}

/** Composite the preview (RGBA8) into `out` with the sampling area tinted
 *  green at 45%, Photoshop's sampling overlay. */
export function tintSamplingOverlay(src: Uint8ClampedArray, sample: Uint8Array, out: Uint8ClampedArray): void {
  out.set(src.subarray(0, sample.length * 4));
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] <= 127) continue;
    const p = i * 4;
    out[p] = src[p] * 0.55;
    out[p + 1] = src[p + 1] * 0.55 + 200 * 0.45;
    out[p + 2] = src[p + 2] * 0.55 + 80 * 0.45;
  }
}
