// Levels / Curves dialog tools beyond the sliders and the point editor: the
// black / gray / white eyedroppers (#435), Auto with Photoshop's Auto Color
// Correction Options, Levels↔Curves conversion, and the .alv / .acv preset
// codecs (#436). Engine-free so every piece unit-tests in node; the dialogs
// feed the results to the same adj.levelsMulti / adj.curves ops as before.
import { autoStretchValue, histBoundsAsym, type Bounds, type Rgb } from "./autoLevels";
import { defaultLevels, type LevelsParams } from "./levelsChannels";

export type { Rgb } from "./autoLevels";
export type DropperKind = "black" | "gray" | "white";
export type CurvePt = { id: string; x: number; y: number };

/** Photoshop's default dropper / auto targets. */
export const DEFAULT_TARGETS: Record<DropperKind, Rgb> = {
  black: { r: 0, g: 0, b: 0 },
  gray: { r: 128, g: 128, b: 128 },
  white: { r: 255, g: 255, b: 255 },
};

const CH = ["r", "g", "b"] as const;
const clamp = (n: number, lo: number, hi: number): number => (n < lo ? lo : n > hi ? hi : n);
const GAMMA_MIN = 0.1;
const GAMMA_MAX = 9.99;

/** The per-channel gamma that carries normalised input `x` to output `y` under
 *  Levels' `x ^ (1 / gamma)`; identity when either end is pinned at 0 or 1. */
function gammaFor(x: number, y: number): number {
  if (x <= 0 || x >= 1 || y <= 0 || y >= 1) return 1;
  return clamp(Math.log(x) / Math.log(y), GAMMA_MIN, GAMMA_MAX);
}

/** What a gray-point sample should become: its own brightness, in the
 *  target's balance (neutral by default). */
function grayGoal(sample: Rgb, target: Rgb): Rgb {
  const brightness = (sample.r + sample.g + sample.b) / 3;
  const targetMean = Math.max((target.r + target.g + target.b) / 3, 1);
  return { r: brightness * target.r / targetMean, g: brightness * target.g / targetMean, b: brightness * target.b / targetMean };
}

/** Levels eyedropper. Black and white rewrite a channel's input point to the
 *  sampled value and its output point to the target; gray neutralises the cast
 *  by giving each channel the gamma that maps the sample to the target's
 *  brightness. Per-channel slots (1..3) change; the composite slot is left
 *  alone, so the droppers compose with the RGB sliders rather than fight them. */
export function levelsFromDropper(params: readonly LevelsParams[], kind: DropperKind, sample: Rgb, target: Rgb): LevelsParams[] {
  const out = params.map((p) => ({ ...p }));
  CH.forEach((c, i) => {
    const p = out[i + 1] ?? (out[i + 1] = defaultLevels());
    const s = clamp(Math.round(sample[c]), 0, 255);
    const t = clamp(Math.round(target[c]), 0, 255);
    if (kind === "black") {
      p.ib = Math.min(s, p.iw - 1);
      p.ob = t;
    } else if (kind === "white") {
      p.iw = Math.max(s, p.ib + 1);
      p.ow = t;
    } else {
      // Photoshop's gray point keeps the pixel's own brightness and only
      // removes the cast: the goal is the sample's mean, tinted by the target.
      const goal = grayGoal(sample, target)[c];
      const x = (s - p.ib) / Math.max(p.iw - p.ib, 1);
      const y = (goal - p.ob) / Math.max(p.ow - p.ob, 1);
      p.gamma = Number(gammaFor(x, y).toFixed(2));
    }
  });
  return out;
}

/** Curves eyedropper: the same three moves as Levels, expressed as the end
 *  points (black / white) or a mid point (gray) of each channel's curve. */
export function curvesFromDropper(ptsByCh: readonly (readonly CurvePt[])[], kind: DropperKind, sample: Rgb, target: Rgb): CurvePt[][] {
  const out = ptsByCh.map((pts) => pts.map((p) => ({ ...p })));
  CH.forEach((c, i) => {
    const pts = out[i + 1] ?? (out[i + 1] = []);
    const x = clamp(sample[c], 0, 255) / 255;
    if (kind === "gray") {
      const y = clamp(grayGoal(sample, target)[c], 0, 255) / 255;
      const inner = pts.filter((p) => p.x > 0 && p.x < 1);
      const keep = pts.filter((p) => !(p.x > 0 && p.x < 1) || Math.abs(p.x - x) > 0.06);
      out[i + 1] = [...keep, { id: inner.find((p) => Math.abs(p.x - x) <= 0.06)?.id ?? `gray-${c}`, x, y }];
      return;
    }
    const y = clamp(target[c], 0, 255) / 255;
    const sorted = [...pts].sort((a, b) => a.x - b.x);
    const end = kind === "black" ? sorted[0] : sorted[sorted.length - 1];
    // The end point takes the sample; inner points it would cross are dropped.
    const rest = pts.filter((p) => p !== end && (kind === "black" ? p.x > x : p.x < x));
    out[i + 1] = [...rest, { id: end?.id ?? `${kind}-${c}`, x, y }];
  });
  return out;
}

// ── Auto ────────────────────────────────────────────────────────────────────

/** Photoshop's Auto Color Correction Options. `monochrome` is Auto Contrast,
 *  `perChannel` Auto Tone, `darkLight` Auto Color (Find Dark & Light Colors).
 *  ponytail: no "Enhance Brightness and Contrast" — it is a content-aware
 *  curve Photoshop does not document; add it when its math is known. */
export type AutoAlgorithm = "monochrome" | "perChannel" | "darkLight";
export interface AutoOptions {
  algorithm: AutoAlgorithm;
  /** Percent of pixels clipped at each end, 0..9.99 — Photoshop's default 0.10. */
  shadowClip: number;
  highlightClip: number;
  /** Auto Color only: neutralise midtones toward the gray target. */
  snapNeutral: boolean;
  targets: Record<DropperKind, Rgb>;
}
export const DEFAULT_AUTO_OPTIONS: AutoOptions = {
  algorithm: "perChannel", shadowClip: 0.1, highlightClip: 0.1, snapNeutral: true,
  targets: { ...DEFAULT_TARGETS },
};

/** 256-bin histograms of the pixels Auto reads, one per channel. */
export type ChannelHists = { r: readonly number[]; g: readonly number[]; b: readonly number[] };

/** 256-bin per-channel histograms of an RGBA buffer — what the dialogs hand
 *  Auto, taken from a snapshot of the document rather than the live composite
 *  (which already carries the preview being edited). */
export function channelHistograms(rgba: Uint8ClampedArray | Uint8Array): ChannelHists {
  const r = new Array<number>(256).fill(0);
  const g = new Array<number>(256).fill(0);
  const b = new Array<number>(256).fill(0);
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    r[rgba[i]]++;
    g[rgba[i + 1]]++;
    b[rgba[i + 2]]++;
  }
  return { r, g, b };
}

/** Mean of a histogram after the stretch that maps `[lo, hi]` onto `[0, 255]`,
 *  in 0..1 — what Auto Color's midtone neutralisation reads. */
function stretchedMean(hist: readonly number[], b: Bounds): number {
  let sum = 0;
  let n = 0;
  for (let v = 0; v < 256; v++) {
    const count = hist[v] ?? 0;
    sum += autoStretchValue(v, b.lo, b.hi) * count;
    n += count;
  }
  return n ? sum / (n * 255) : 0.5;
}

const GAMMA_FLOOR = 0.004;
const GAMMA_CEIL = 0.996;

/** The Levels that Auto would apply: the input points from the clipped
 *  histogram bounds, the output points from the shadow / highlight targets,
 *  and — for Auto Color with Snap Neutral — the gamma that pulls each
 *  channel's mean to the neutral target. Mirrors autoLevels.ts, which mirrors
 *  the engine, so Auto in the dialog and Image ▸ Auto agree. */
export function autoLevelsParams(hists: ChannelHists, opts: AutoOptions): LevelsParams[] {
  const lo = clamp(opts.shadowClip, 0, 9.99) / 100;
  const hi = clamp(opts.highlightClip, 0, 9.99) / 100;
  const out = [defaultLevels(), defaultLevels(), defaultLevels(), defaultLevels()];
  if (opts.algorithm === "monochrome") {
    const combined = new Array<number>(256).fill(0);
    for (let v = 0; v < 256; v++) combined[v] = (hists.r[v] ?? 0) + (hists.g[v] ?? 0) + (hists.b[v] ?? 0);
    const b = histBoundsAsym(combined, lo, hi);
    if (b.hi > b.lo) {
      out[0].ib = b.lo;
      out[0].iw = b.hi;
      const t = opts.targets;
      out[0].ob = Math.round((t.black.r + t.black.g + t.black.b) / 3);
      out[0].ow = Math.round((t.white.r + t.white.g + t.white.b) / 3);
    }
    return out;
  }
  const bounds = CH.map((c) => histBoundsAsym(hists[c], lo, hi));
  if (bounds.every((b) => b.hi <= b.lo)) return out;
  const means = CH.map((c, i) => stretchedMean(hists[c], bounds[i]));
  const neutral = clamp((means[0] + means[1] + means[2]) / 3, GAMMA_FLOOR, GAMMA_CEIL);
  CH.forEach((c, i) => {
    const p = out[i + 1];
    p.ib = bounds[i].lo;
    p.iw = Math.max(bounds[i].hi, p.ib + 1);
    p.ob = clamp(Math.round(opts.targets.black[c]), 0, 255);
    p.ow = clamp(Math.round(opts.targets.white[c]), 0, 255);
    if (opts.algorithm === "darkLight" && opts.snapNeutral) {
      // autoLevels.ts applies mean ^ invGamma = target; Levels' gamma is 1/invGamma.
      const m = clamp(means[i], GAMMA_FLOOR, GAMMA_CEIL);
      p.gamma = Number(clamp(Math.log(m) / Math.log(neutral), GAMMA_MIN, GAMMA_MAX).toFixed(2));
    }
  });
  return out;
}

/** Levels params as curve points, so Auto and the presets speak both dialects. */
export function levelsToCurvePoints(p: LevelsParams, prefix = "lv"): CurvePt[] {
  const ib = p.ib / 255;
  const iw = p.iw / 255;
  const ob = p.ob / 255;
  const ow = p.ow / 255;
  const pts: CurvePt[] = [{ id: `${prefix}-lo`, x: ib, y: ob }];
  if (Math.abs(p.gamma - 1) > 1e-3) {
    const mx = (ib + iw) / 2;
    pts.push({ id: `${prefix}-mid`, x: mx, y: ob + (ow - ob) * Math.pow(0.5, 1 / p.gamma) });
  }
  pts.push({ id: `${prefix}-hi`, x: iw, y: ow });
  return pts;
}

/** Auto for Curves: the same correction as `autoLevelsParams`, as points. A
 *  channel Auto leaves at identity keeps the plain diagonal. */
export function autoCurvePoints(hists: ChannelHists, opts: AutoOptions): CurvePt[][] {
  return autoLevelsParams(hists, opts).map((p, i) => {
    const identity = p.ib === 0 && p.iw === 255 && p.ob === 0 && p.ow === 255 && Math.abs(p.gamma - 1) < 1e-3;
    return identity
      ? [{ id: "lo", x: 0, y: 0 }, { id: "mid", x: 0.5, y: 0.5 }, { id: "hi", x: 1, y: 1 }]
      : levelsToCurvePoints(p, `auto${i}`);
  });
}

// ── Presets: Adobe .alv (Levels) and .acv (Curves) ─────────────────────────
// Both are big-endian u16 streams. .alv: version 2, then 29 channel records of
// [input floor, input ceiling, output floor, output ceiling, gamma × 100],
// master first then R, G, B. .acv: version 4, curve count, then per curve a
// point count and (output, input) pairs — output FIRST — master then R, G, B.

const ALV_VERSION = 2;
const ALV_RECORDS = 29;
const ACV_VERSION = 4;
const MAX_ACV_CURVES = 32;
const MAX_ACV_POINTS = 19; // Photoshop's own ceiling per curve

class Words {
  private view: DataView;
  private p = 0;
  constructor(bytes: Uint8Array) { this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
  get remaining(): number { return this.view.byteLength - this.p; }
  u16(): number {
    if (this.p + 2 > this.view.byteLength) throw new Error("truncated preset");
    const v = this.view.getUint16(this.p);
    this.p += 2;
    return v;
  }
}
function words(values: number[]): Uint8Array {
  const out = new Uint8Array(values.length * 2);
  const view = new DataView(out.buffer);
  values.forEach((v, i) => view.setUint16(i * 2, clamp(Math.round(v), 0, 65535)));
  return out;
}

/** Levels → .alv bytes (master, R, G, B; the remaining records identity). */
export function encodeAlv(params: readonly LevelsParams[]): Uint8Array {
  const values = [ALV_VERSION];
  for (let i = 0; i < ALV_RECORDS; i++) {
    const p = params[i] ?? defaultLevels();
    values.push(p.ib, p.iw, p.ob, p.ow, Math.round(p.gamma * 100));
  }
  return words(values);
}

/** .alv bytes → four Levels param sets, or null when it is not a Levels file. */
export function decodeAlv(bytes: Uint8Array): LevelsParams[] | null {
  try {
    const r = new Words(bytes);
    if (r.u16() !== ALV_VERSION) return null;
    const out: LevelsParams[] = [];
    for (let i = 0; i < 4; i++) {
      if (r.remaining < 10) return null;
      const ib = clamp(r.u16(), 0, 254);
      const iw = clamp(r.u16(), ib + 1, 255);
      const ob = clamp(r.u16(), 0, 255);
      const ow = clamp(r.u16(), 0, 255);
      const gamma = clamp(r.u16() / 100, GAMMA_MIN, GAMMA_MAX);
      out.push({ ib, iw, ob, ow, gamma: Number(gamma.toFixed(2)) });
    }
    return out;
  } catch {
    return null;
  }
}

/** Curves → .acv bytes: master, R, G, B. Points are stored on Photoshop's
 *  0..255 grid, output before input. */
export function encodeAcv(ptsByCh: readonly (readonly CurvePt[])[]): Uint8Array {
  const values = [ACV_VERSION, 4];
  for (let i = 0; i < 4; i++) {
    const pts = [...(ptsByCh[i] ?? [])].sort((a, b) => a.x - b.x).slice(0, MAX_ACV_POINTS);
    const curve = pts.length >= 2 ? pts : [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    values.push(curve.length);
    for (const p of curve) values.push(clamp(p.y, 0, 1) * 255, clamp(p.x, 0, 1) * 255);
  }
  return words(values);
}

/** .acv bytes → per-channel points (master, R, G, B), or null when it is not
 *  a Curves file. Extra curves in the file (alpha, spot) are ignored. */
export function decodeAcv(bytes: Uint8Array): CurvePt[][] | null {
  try {
    const r = new Words(bytes);
    if (r.u16() !== ACV_VERSION) return null;
    const count = r.u16();
    if (count < 1 || count > MAX_ACV_CURVES) return null;
    const out: CurvePt[][] = [];
    for (let c = 0; c < count; c++) {
      const n = r.u16();
      if (n > MAX_ACV_POINTS) return null;
      const pts: CurvePt[] = [];
      for (let i = 0; i < n; i++) {
        const y = clamp(r.u16(), 0, 255) / 255;
        const x = clamp(r.u16(), 0, 255) / 255;
        pts.push({ id: `acv-${c}-${i}`, x, y });
      }
      if (c < 4) out.push(pts.length >= 2 ? pts : [{ id: `acv-${c}-lo`, x: 0, y: 0 }, { id: `acv-${c}-hi`, x: 1, y: 1 }]);
    }
    while (out.length < 4) out.push([{ id: `acv-${out.length}-lo`, x: 0, y: 0 }, { id: `acv-${out.length}-hi`, x: 1, y: 1 }]);
    return out;
  } catch {
    return null;
  }
}

// ── Curves point editing + clipping preview ─────────────────────────────────

/** Set the selected point's Input / Output (0..255), keeping it between its
 *  neighbours so the curve stays a function of input. */
export function setCurvePointValue(pts: readonly CurvePt[], id: string, axis: "x" | "y", value255: number): CurvePt[] {
  const sorted = [...pts].sort((a, b) => a.x - b.x);
  const i = sorted.findIndex((p) => p.id === id);
  if (i < 0) return [...pts];
  const v = clamp(value255, 0, 255) / 255;
  if (axis === "y") return pts.map((p) => (p.id === id ? { ...p, y: v } : p));
  const lo = i > 0 ? sorted[i - 1].x + 1 / 255 : 0;
  const hi = i < sorted.length - 1 ? sorted[i + 1].x - 1 / 255 : 1;
  return pts.map((p) => (p.id === id ? { ...p, x: clamp(v, lo, hi) } : p));
}

/** Pencil mode: a freehand stroke sampled into curve points, one per 16
 *  input levels, so the drawn shape replaces the channel's points. */
export function pencilPoints(samples: readonly { x: number; y: number }[], prefix = "pen"): CurvePt[] {
  if (samples.length === 0) return [];
  const columns = new Map<number, number>();
  for (const s of samples) {
    const col = Math.round(clamp(s.x, 0, 1) * 16);
    columns.set(col, clamp(s.y, 0, 1)); // the last pass over a column wins
  }
  return [...columns.entries()].sort((a, b) => a[0] - b[0]).map(([col, y]) => ({ id: `${prefix}-${col}`, x: col / 16, y }));
}

/** Show Clipping: which pixels the curves push to pure black or white. Marks
 *  a pixel when any channel's LUT output lands on 0 (shadow) or 255
 *  (highlight); returns 0 = none, 1 = shadow, 2 = highlight, 3 = both. */
export function clippingMask(rgba: Uint8ClampedArray | Uint8Array, luts: { master: Uint8Array; r: Uint8Array; g: Uint8Array; b: Uint8Array }): Uint8Array {
  const n = rgba.length >> 2;
  const out = new Uint8Array(n);
  const chans = [luts.r, luts.g, luts.b];
  for (let i = 0; i < n; i++) {
    let flags = 0;
    for (let c = 0; c < 3; c++) {
      const v = chans[c][luts.master[rgba[i * 4 + c]]];
      if (v === 0) flags |= 1;
      else if (v === 255) flags |= 2;
    }
    out[i] = flags;
  }
  return out;
}
