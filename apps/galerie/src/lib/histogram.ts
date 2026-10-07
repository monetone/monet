// histogram — pure RGB + luminance histogram over RGBA pixels. Kept separate
// from the panel so the binning is unit-tested without a canvas. 256 buckets
// per channel; fully-transparent pixels are ignored (padding from letterboxed
// previews must not spike bucket 0).

export interface Histogram {
  r: Uint32Array;
  g: Uint32Array;
  b: Uint32Array;
  /** Rec.601 luma (matches the engine's luminance convention). */
  lum: Uint32Array;
  /** Peak bucket across all channels, excluding the clipping endpoints 0/255,
   *  so a large clipped spike doesn't flatten the interesting midtones. */
  max: number;
  /** Pixels counted (fully-transparent padding excluded) — the denominator for
   *  the clipping percentages. */
  total: number;
  /** Pixels with *any* channel pinned at 0 / at 255. Counted here because it
   *  can't be recovered from the per-channel bins (a pixel may clip in two). */
  clippedLo: number;
  clippedHi: number;
}

export function computeHistogram(data: Uint8ClampedArray | Uint8Array): Histogram {
  const r = new Uint32Array(256);
  const g = new Uint32Array(256);
  const b = new Uint32Array(256);
  const lum = new Uint32Array(256);
  let total = 0;
  let clippedLo = 0;
  let clippedHi = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] === 0) continue; // fully transparent — skip
    const R = data[i];
    const G = data[i + 1];
    const B = data[i + 2];
    r[R]++;
    g[G]++;
    b[B]++;
    lum[(R * 0.299 + G * 0.587 + B * 0.114) | 0]++;
    total++;
    if (R === 0 || G === 0 || B === 0) clippedLo++;
    if (R === 255 || G === 255 || B === 255) clippedHi++;
  }
  let max = 1;
  for (let i = 1; i < 255; i++) {
    if (r[i] > max) max = r[i];
    if (g[i] > max) max = g[i];
    if (b[i] > max) max = b[i];
    if (lum[i] > max) max = lum[i];
  }
  return { r, g, b, lum, max, total, clippedLo, clippedHi };
}

/** What the two clipping triangles above the histogram show. */
export interface Clipping {
  /** Fraction (0–1) of counted pixels clipped at the black / white end. */
  shadows: number;
  highlights: number;
  /** Colour of each triangle. Lightroom tints it additively by the channels that
   *  clip: one channel shows that channel, all three show white. */
  shadowColor: string;
  highlightColor: string;
}

const clipColor = (r: boolean, g: boolean, b: boolean) =>
  `rgb(${r ? 255 : 0},${g ? 255 : 0},${b ? 255 : 0})`;

export function clipping(h: Histogram): Clipping {
  const total = Math.max(1, h.total); // no pixels counted → 0%, never NaN
  return {
    shadows: h.clippedLo / total,
    highlights: h.clippedHi / total,
    shadowColor: clipColor(h.r[0] > 0, h.g[0] > 0, h.b[0] > 0),
    highlightColor: clipColor(h.r[255] > 0, h.g[255] > 0, h.b[255] > 0),
  };
}

export type ToneRegion = "Blacks" | "Shadows" | "Exposure" | "Highlights" | "Whites";

/** The Basic slider that owns a 0–255 position, the way Lightroom names the
 *  region under the histogram cursor.
 *  ponytail: fixed cuts at 10/35/65/90% of the axis rather than the process
 *  version's real tone-curve breakpoints — swap in per-version cuts if the
 *  develop pipeline ever exposes them. */
export function toneRegion(level: number): ToneRegion {
  if (level < 26) return "Blacks";
  if (level < 90) return "Shadows";
  if (level < 166) return "Exposure";
  if (level < 230) return "Highlights";
  return "Whites";
}

/** Per-channel share (0–1) of counted pixels sitting at one 0–255 level — the
 *  R/G/B readout under the cursor. */
export function levelShare(h: Histogram, level: number): { r: number; g: number; b: number } {
  const i = clampLevel(level);
  const total = Math.max(1, h.total);
  return { r: h.r[i] / total, g: h.g[i] / total, b: h.b[i] / total };
}

/** Pointer x (px) within a `width`-px histogram box → its 0–255 level. Clamped:
 *  a pointer capture can report coordinates past either edge. */
export function levelAt(x: number, width: number): number {
  if (!(width > 0)) return 0;
  return clampLevel((x / width) * 255);
}

const clampLevel = (level: number) => Math.min(255, Math.max(0, Math.round(level) || 0));

/** An SVG path (closed area) for one channel, scaled to a `w`×`h` box. */
export function channelPath(ch: Uint32Array, max: number, w = 255, h = 100): string {
  const n = ch.length - 1; // 255
  let d = `M0,${h}`;
  for (let i = 0; i < ch.length; i++) {
    const x = ((i / n) * w).toFixed(2);
    const y = (h - Math.min(1, ch[i] / max) * h).toFixed(2);
    d += ` L${x},${y}`;
  }
  return `${d} L${w},${h} Z`;
}
