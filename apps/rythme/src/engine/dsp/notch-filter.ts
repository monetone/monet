// ─────────────────────────────────────────────────────────────
// engine/dsp/notch-filter — Adobe Audition–style Notch Filter
// ─────────────────────────────────────────────────────────────
// Removes a set of INDEPENDENT, arbitrary frequencies — each with its own
// attenuation depth — sharing a Q (notch width). Unlike the DeHummer (a single
// fundamental + its harmonics) the frequencies need not be related: pull a
// 1.3 kHz whistle, a 60 Hz hum and an A-440 tone in one pass. Each notch is an
// RBJ peaking biquad at negative gain; a peaking section reaches exactly its
// gainDb at the center frequency regardless of Q, so the depth is precise and
// the Q only sets the width. Pure `(AudioData, opts) => AudioData`; the input is
// never mutated.

import { cloneAudioData } from "../audio/buffer";
import { gainToDb } from "../audio/db";
import type { AudioData } from "../audio/types";
import { biquadMagnitude, designBiquad, processBiquadChannel } from "./biquad";

/** One notch: a frequency and how far to attenuate it. */
export interface NotchBand {
  /** Center frequency to remove, in Hz. */
  frequency: number;
  /** Attenuation at the center, in dB (negative cuts; default -40). */
  gainDb?: number;
}

export interface NotchFilterOptions {
  /** Independent notches to apply. An empty list is a passthrough. */
  notches?: NotchBand[];
  /** Shared quality factor (notch width). Higher = narrower. Default 30. */
  q?: number;
}

const DEFAULT_GAIN_DB = -40;
const DEFAULT_Q = 30;

/**
 * Combined response of the notch cascade at a frequency, in dB. Sums each
 * notch's peaking-biquad magnitude: at a notch's own center this equals that
 * notch's gainDb (plus any small leakage from the others), and far from every
 * notch it tends to 0 dB. Pure and exact — handy for tests and curve display.
 */
export function notchResponseDb(opts: NotchFilterOptions, freq: number, sampleRate: number): number {
  const notches = opts.notches ?? [];
  const q = opts.q ?? DEFAULT_Q;
  let db = 0;
  for (const n of notches) {
    const c = designBiquad({ type: "peaking", freq: n.frequency, q, gainDb: n.gainDb ?? DEFAULT_GAIN_DB }, sampleRate);
    db += gainToDb(biquadMagnitude(c, freq, sampleRate));
  }
  return db;
}

/**
 * Apply the notch cascade. Each notch is a peaking biquad at negative gain,
 * applied in series to every channel. Frame count is preserved and the input is
 * not mutated.
 */
export function notchFilter(d: AudioData, opts: NotchFilterOptions = {}): AudioData {
  const notches = opts.notches ?? [];
  const q = opts.q ?? DEFAULT_Q;
  const out = cloneAudioData(d);
  for (const n of notches) {
    const coeffs = designBiquad({ type: "peaking", freq: n.frequency, q, gainDb: n.gainDb ?? DEFAULT_GAIN_DB }, d.sampleRate);
    for (const ch of out.channels) processBiquadChannel(ch, coeffs);
  }
  return out;
}
