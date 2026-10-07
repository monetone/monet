// ─────────────────────────────────────────────────────────────
// engine/dsp/biquad — RBJ cookbook biquad filters
// ─────────────────────────────────────────────────────────────
// The workhorse second-order IIR section behind the EQ and the filter tools.
// Coefficients follow Robert Bristow-Johnson's "Audio EQ Cookbook"; processing
// uses Transposed Direct Form II with per-channel state, so a single design can
// filter an arbitrary number of channels without cross-talk.

import { cloneAudioData } from "../audio/buffer";
import type { AudioData } from "../audio/types";

export type BiquadType =
  | "lowpass"
  | "highpass"
  | "bandpass"
  | "notch"
  | "allpass"
  | "peaking"
  | "lowshelf"
  | "highshelf";

/** Normalized coefficients (a0 folded out). */
export interface BiquadCoeffs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

export interface BiquadSpec {
  type: BiquadType;
  /** Center / corner frequency in Hz. */
  freq: number;
  /** Quality factor (bandwidth). Ignored by shelves which use `slope`-as-Q. */
  q?: number;
  /** Gain in dB (peaking & shelf filters only). */
  gainDb?: number;
}

/** Design biquad coefficients for the given spec at `sampleRate`. */
export function designBiquad(spec: BiquadSpec, sampleRate: number): BiquadCoeffs {
  const q = spec.q ?? Math.SQRT1_2; // 0.7071 → maximally flat
  const gainDb = spec.gainDb ?? 0;
  const f0 = Math.min(Math.max(spec.freq, 1), sampleRate / 2 - 1);
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * f0) / sampleRate;
  const cos0 = Math.cos(w0);
  const sin0 = Math.sin(w0);
  const alpha = sin0 / (2 * q);

  let b0 = 1;
  let b1 = 0;
  let b2 = 0;
  let a0 = 1;
  let a1 = 0;
  let a2 = 0;

  switch (spec.type) {
    case "lowpass":
      b0 = (1 - cos0) / 2;
      b1 = 1 - cos0;
      b2 = (1 - cos0) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cos0;
      a2 = 1 - alpha;
      break;
    case "highpass":
      b0 = (1 + cos0) / 2;
      b1 = -(1 + cos0);
      b2 = (1 + cos0) / 2;
      a0 = 1 + alpha;
      a1 = -2 * cos0;
      a2 = 1 - alpha;
      break;
    case "bandpass": // constant 0 dB peak gain
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
      a0 = 1 + alpha;
      a1 = -2 * cos0;
      a2 = 1 - alpha;
      break;
    case "notch":
      b0 = 1;
      b1 = -2 * cos0;
      b2 = 1;
      a0 = 1 + alpha;
      a1 = -2 * cos0;
      a2 = 1 - alpha;
      break;
    case "allpass":
      b0 = 1 - alpha;
      b1 = -2 * cos0;
      b2 = 1 + alpha;
      a0 = 1 + alpha;
      a1 = -2 * cos0;
      a2 = 1 - alpha;
      break;
    case "peaking":
      b0 = 1 + alpha * A;
      b1 = -2 * cos0;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cos0;
      a2 = 1 - alpha / A;
      break;
    case "lowshelf": {
      const sqrtA = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 - (A - 1) * cos0 + sqrtA);
      b1 = 2 * A * (A - 1 - (A + 1) * cos0);
      b2 = A * (A + 1 - (A - 1) * cos0 - sqrtA);
      a0 = A + 1 + (A - 1) * cos0 + sqrtA;
      a1 = -2 * (A - 1 + (A + 1) * cos0);
      a2 = A + 1 + (A - 1) * cos0 - sqrtA;
      break;
    }
    case "highshelf": {
      const sqrtA = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 + (A - 1) * cos0 + sqrtA);
      b1 = -2 * A * (A - 1 + (A + 1) * cos0);
      b2 = A * (A + 1 + (A - 1) * cos0 - sqrtA);
      a0 = A + 1 - (A - 1) * cos0 + sqrtA;
      a1 = 2 * (A - 1 - (A + 1) * cos0);
      a2 = A + 1 - (A - 1) * cos0 - sqrtA;
      break;
    }
  }

  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** Process a single channel in place (Transposed Direct Form II). */
export function processBiquadChannel(samples: Float32Array, c: BiquadCoeffs): void {
  let z1 = 0;
  let z2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i];
    const y = c.b0 * x + z1;
    z1 = c.b1 * x - c.a1 * y + z2;
    z2 = c.b2 * x - c.a2 * y;
    samples[i] = y;
  }
}

/** Apply one biquad section to every channel, returning a new buffer. */
export function applyBiquad(d: AudioData, spec: BiquadSpec): AudioData {
  const coeffs = designBiquad(spec, d.sampleRate);
  const out = cloneAudioData(d);
  for (const ch of out.channels) processBiquadChannel(ch, coeffs);
  return out;
}

/**
 * Apply a biquad N times (cascaded) for steeper roll-off — each pass adds
 * ~12 dB/oct. Useful for the "low cut / high cut" filter tools.
 */
export function applyBiquadCascade(d: AudioData, spec: BiquadSpec, passes: number): AudioData {
  let out = d;
  for (let i = 0; i < Math.max(1, passes); i++) out = applyBiquad(out, spec);
  return out;
}

/** Magnitude (linear) of a biquad at frequency `f` — for plotting EQ curves. */
export function biquadMagnitude(c: BiquadCoeffs, f: number, sampleRate: number): number {
  const w = (2 * Math.PI * f) / sampleRate;
  const cosw = Math.cos(w);
  const cos2w = Math.cos(2 * w);
  const sinw = Math.sin(w);
  const sin2w = Math.sin(2 * w);
  // H(z) = (b0 + b1 z^-1 + b2 z^-2) / (1 + a1 z^-1 + a2 z^-2)
  const numRe = c.b0 + c.b1 * cosw + c.b2 * cos2w;
  const numIm = -(c.b1 * sinw + c.b2 * sin2w);
  const denRe = 1 + c.a1 * cosw + c.a2 * cos2w;
  const denIm = -(c.a1 * sinw + c.a2 * sin2w);
  const num = Math.hypot(numRe, numIm);
  const den = Math.hypot(denRe, denIm);
  return den === 0 ? 0 : num / den;
}
