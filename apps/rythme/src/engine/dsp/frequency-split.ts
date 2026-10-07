// ─────────────────────────────────────────────────────────────
// engine/dsp/frequency-split — Adobe Audition–style Frequency Band Splitter
// ─────────────────────────────────────────────────────────────
// Audition's Frequency Band Splitter: take a clip and make up to 8 band-limited
// copies, one per frequency range, each on its own track so you can edit or
// process the bands independently and recombine them. N ascending crossover
// frequencies produce N+1 bands (Audition's default is two crossovers — 800 and
// 3200 Hz — for low/mid/high).
//
// The defining property of a band splitter is that the bands sum *back to the
// original*. We get that exactly with a subtractive crossover: take the
// cumulative low-pass of the input at each crossover (L_k = lowpass(x, f_k)) and
// difference consecutive ones — band 0 = L_1, band k = L_{k+1} − L_k, top band =
// x − L_N — so the set telescopes to x for any filter. The low-pass is run
// *zero-phase* (forward–backward, like Audition's linear-phase FIR) so the
// subtraction is a clean high-pass with no phase-mismatch leakage and each band
// stays well isolated. Returns an array of buffers (frame/channel count
// preserved); the input is never mutated.

import { cloneAudioData } from "../audio/buffer";
import { frameCount, type AudioData } from "../audio/types";
import { reverse } from "./basic";
import { lowpass } from "./filter";

/** Up to 8 bands, matching Audition's limit. */
const MAX_BANDS = 8;

export interface FrequencyBandSplitOptions {
  /** Ascending crossover frequencies in Hz; N crossovers → N+1 bands. Default [800, 3200]. */
  crossovers?: number[];
  /** Low-pass steepness in ~12 dB/oct passes (default 2 → ~24 dB/oct). */
  passes?: number;
}

/** Zero-phase low-pass (forward–backward) so x − L is a clean, in-phase high-pass. */
function zeroPhaseLowpass(d: AudioData, fc: number, passes: number): AudioData {
  const forward = lowpass(d, fc, Math.SQRT1_2, passes);
  const backward = lowpass(reverse(forward), fc, Math.SQRT1_2, passes);
  return reverse(backward);
}

/** Per-sample a − b into a new buffer (same shape). */
function difference(a: AudioData, b: AudioData): AudioData {
  const out = cloneAudioData(a);
  for (let c = 0; c < out.channels.length; c++) {
    const x = out.channels[c];
    const y = b.channels[c];
    for (let i = 0; i < x.length; i++) x[i] -= y[i];
  }
  return out;
}

/**
 * Split into N+1 frequency bands at the given crossovers. The bands sum exactly
 * back to the input. With no usable crossover the result is a single copy.
 */
export function frequencyBandSplit(d: AudioData, opts: FrequencyBandSplitOptions = {}): AudioData[] {
  const nyquist = d.sampleRate / 2;
  const crossovers = [...new Set((opts.crossovers ?? [800, 3200]).filter((f) => f > 0 && f < nyquist))]
    .sort((a, b) => a - b)
    .slice(0, MAX_BANDS - 1); // ≤ 7 crossovers → ≤ 8 bands
  const passes = Math.max(1, opts.passes ?? 2);

  if (frameCount(d) === 0 || crossovers.length === 0) return [cloneAudioData(d)];

  const lows = crossovers.map((fc) => zeroPhaseLowpass(d, fc, passes));
  const bands: AudioData[] = [lows[0]]; // 0 … f1
  for (let i = 1; i < lows.length; i++) bands.push(difference(lows[i], lows[i - 1])); // f_i … f_{i+1}
  bands.push(difference(d, lows[lows.length - 1])); // f_N … Nyquist
  return bands;
}

/** Human labels for the bands of a given crossover set, e.g. "0–800 Hz". */
export function frequencyBandLabels(crossovers: number[], sampleRate: number): string[] {
  const xs = [...new Set(crossovers.filter((f) => f > 0 && f < sampleRate / 2))].sort((a, b) => a - b).slice(0, MAX_BANDS - 1);
  if (xs.length === 0) return ["Full Band"];
  const hz = (f: number) => (f >= 1000 ? `${(f / 1000).toFixed(f % 1000 === 0 ? 0 : 1)} kHz` : `${Math.round(f)} Hz`);
  const labels = [`0–${hz(xs[0])}`];
  for (let i = 1; i < xs.length; i++) labels.push(`${hz(xs[i - 1])}–${hz(xs[i])}`);
  labels.push(`${hz(xs[xs.length - 1])}+`);
  return labels;
}
