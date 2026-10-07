// ─────────────────────────────────────────────────────────────
// Per-channel histogram — pure helpers for the Histogram panel's Channel selector
// (Photoshop). channelCounts builds a 256-bin histogram of a chosen channel from an
// RGBA buffer; downsampleBins turns it into the log-normalised curve the panel draws.
// Engine-free so they unit-test in node; EngineClient.channelHistogram supplies the
// buffer, and histogramStats consumes the 256-bin counts for the readout.
// ─────────────────────────────────────────────────────────────

import { rgbToCmyk } from "./rgbCmyk";
import { rgbToLab } from "./rgbLab";

export type HistChannel = "luma" | "r" | "g" | "b" | "lab-l" | "lab-a" | "lab-b" | "c" | "m" | "y" | "k";

export interface HistogramChannelOption {
  id: HistChannel;
  label: string;
  accent: string;
}

const RGB_CHANNELS: HistogramChannelOption[] = [
  { id: "luma", label: "Luminance", accent: "var(--accent-raster)" },
  { id: "r", label: "Red", accent: "#ff4d4d" },
  { id: "g", label: "Green", accent: "#3ec96b" },
  { id: "b", label: "Blue", accent: "#4d8dff" },
];

const GRAY_CHANNELS: HistogramChannelOption[] = [
  { id: "luma", label: "Gray", accent: "var(--accent-raster)" },
];

const LAB_CHANNELS: HistogramChannelOption[] = [
  { id: "lab-l", label: "Lightness", accent: "#d8d8d8" },
  { id: "lab-a", label: "a", accent: "#d955a8" },
  { id: "lab-b", label: "b", accent: "#d7b64b" },
];

const CMYK_CHANNELS: HistogramChannelOption[] = [
  { id: "c", label: "Cyan", accent: "#35c7d8" },
  { id: "m", label: "Magenta", accent: "#d84fb5" },
  { id: "y", label: "Yellow", accent: "#d9c340" },
  { id: "k", label: "Black", accent: "#8b8f99" },
];

export function histogramChannelOptions(mode: number): HistogramChannelOption[] {
  if (mode === 1) return GRAY_CHANNELS;
  if (mode === 2 || mode === 4) return CMYK_CHANNELS;
  if (mode === 3) return LAB_CHANNELS;
  return RGB_CHANNELS;
}

export function histogramAllChannelOptions(mode: number): HistogramChannelOption[] {
  const options = histogramChannelOptions(mode);
  return mode === 0 ? options.filter((o) => o.id !== "luma") : options;
}

const bin = (value: number): number => {
  const v = Math.round(value);
  return v < 0 ? 0 : v > 255 ? 255 : v;
};

/** 256-bin histogram (count per level) of `channel` over an RGBA byte buffer.
 *  luma uses Rec.601 (0.299/0.587/0.114), rounded and clamped to 0..255. */
export function channelCounts(rgba: ArrayLike<number>, channel: HistChannel): number[] {
  const out = new Array(256).fill(0);
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    let v: number;
    if (channel === "r") v = rgba[i];
    else if (channel === "g") v = rgba[i + 1];
    else if (channel === "b") v = rgba[i + 2];
    else if (channel === "lab-l" || channel === "lab-a" || channel === "lab-b") {
      const lab = rgbToLab(rgba[i], rgba[i + 1], rgba[i + 2]);
      if (channel === "lab-l") v = lab.l * 255 / 100;
      else if (channel === "lab-a") v = lab.a + 128;
      else v = lab.b + 128;
    } else if (channel === "c" || channel === "m" || channel === "y" || channel === "k") {
      const cmyk = rgbToCmyk(rgba[i], rgba[i + 1], rgba[i + 2]);
      v = cmyk[channel] * 255 / 100;
    }
    else v = Math.round(rgba[i] * 0.299 + rgba[i + 1] * 0.587 + rgba[i + 2] * 0.114);
    out[bin(v)]++;
  }
  return out;
}

/** Downsample a 256-bin histogram to `bins` log-normalised bars (0..1) for the
 *  curve display: each level maps to bucket min(bins-1, (lvl/255 * bins)|0). */
export function downsampleBins(counts: number[], bins: number): number[] {
  const out = new Array(bins).fill(0);
  for (let lvl = 0; lvl < counts.length; lvl++) {
    const b = Math.min(bins - 1, ((lvl / 255) * bins) | 0);
    out[b] += counts[lvl];
  }
  let max = 1;
  for (const v of out) if (v > max) max = v;
  const lmax = Math.log(max + 1);
  return out.map((v) => Math.log(v + 1) / lmax);
}

/** Down-sampled R/G/B histogram bars for the Histogram panel's "All Channels View"
 *  (each channel's curve, log-normalised independently). Composes channelCounts +
 *  downsampleBins per channel — no new histogram maths. */
export function allChannelBars(rgba: ArrayLike<number>, bins: number): { r: number[]; g: number[]; b: number[] } {
  return {
    r: downsampleBins(channelCounts(rgba, "r"), bins),
    g: downsampleBins(channelCounts(rgba, "g"), bins),
    b: downsampleBins(channelCounts(rgba, "b"), bins),
  };
}

export function channelBars(rgba: ArrayLike<number>, channel: HistChannel, bins: number): number[] {
  return downsampleBins(channelCounts(rgba, channel), bins);
}
