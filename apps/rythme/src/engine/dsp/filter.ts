// ─────────────────────────────────────────────────────────────
// engine/dsp/filter — convenience filter tools
// ─────────────────────────────────────────────────────────────
// Thin wrappers over the biquad section for the common "filter" menu items.
// `passes` cascades the section for steeper slopes (~12 dB/oct each).

import type { AudioData } from "../audio/types";
import { applyBiquadCascade } from "./biquad";

export function lowpass(d: AudioData, freq: number, q = Math.SQRT1_2, passes = 1): AudioData {
  return applyBiquadCascade(d, { type: "lowpass", freq, q }, passes);
}

export function highpass(d: AudioData, freq: number, q = Math.SQRT1_2, passes = 1): AudioData {
  return applyBiquadCascade(d, { type: "highpass", freq, q }, passes);
}

export function bandpass(d: AudioData, freq: number, q = 1, passes = 1): AudioData {
  return applyBiquadCascade(d, { type: "bandpass", freq, q }, passes);
}

export function notch(d: AudioData, freq: number, q = 8, passes = 1): AudioData {
  return applyBiquadCascade(d, { type: "notch", freq, q }, passes);
}

/** "Low cut" (a.k.a. high-pass) tone tool with a default 80 Hz corner. */
export function lowCut(d: AudioData, freq = 80, passes = 2): AudioData {
  return highpass(d, freq, Math.SQRT1_2, passes);
}

/** "High cut" (a.k.a. low-pass) tone tool with a default 16 kHz corner. */
export function highCut(d: AudioData, freq = 16000, passes = 2): AudioData {
  return lowpass(d, freq, Math.SQRT1_2, passes);
}
