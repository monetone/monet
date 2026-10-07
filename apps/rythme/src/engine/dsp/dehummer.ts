// ─────────────────────────────────────────────────────────────
// engine/dsp/dehummer — Adobe Audition–style hum removal
// ─────────────────────────────────────────────────────────────
// Removes mains/power-line hum: a fundamental frequency (60 Hz in North
// America, 50 Hz most elsewhere) plus its harmonics. Like Audition's DeHummer,
// it places a narrow filter at the root frequency and at each integer multiple,
// so the buzz and its overtones are notched out while the rest of the audio is
// left alone.
//
// Two modes, both built from the shared RBJ biquads (./biquad):
//   • "peaking" (default) — a deep negative-gain dip at each harmonic, so
//     `reductionDb` (Audition's "Gain") sets exactly how much hum is removed.
//   • "notch" — a true null at each harmonic for total removal.
// `harmonicFalloff` tapers the reduction for higher harmonics (Audition's
// harmonic-slope control). Pure `(AudioData, opts) => AudioData`; never mutates.

import { cloneAudioData } from "../audio/buffer";
import { clamp } from "../audio/db";
import { channelCount, frameCount, type AudioData } from "../audio/types";
import { designBiquad, processBiquadChannel, type BiquadType } from "./biquad";

export interface DeHummerOptions {
  /** Root / fundamental hum frequency in Hz (Audition "Frequency"). */
  frequency?: number;
  /** Filter quality — higher Q is a narrower notch (Audition "Q"). */
  q?: number;
  /** Reduction per harmonic in dB, ≤ 0 (Audition "Gain"); peaking mode only. */
  reductionDb?: number;
  /** Number of harmonics to filter, including the fundamental (Audition "Number of Harmonics"). */
  harmonics?: number;
  /** Per-harmonic reduction taper, 0…1 (1 = every harmonic reduced equally). */
  harmonicFalloff?: number;
  /** "peaking" (controllable dip, default) or "notch" (true null). */
  mode?: "peaking" | "notch";
}

/**
 * Remove power-line hum and its harmonics. Cascades one biquad per harmonic at
 * `frequency × h`, skipping any harmonic at or above Nyquist. The result keeps
 * the input's channel count and frame count; the input is never modified.
 */
export function deHum(d: AudioData, opts: DeHummerOptions = {}): AudioData {
  const frequency = opts.frequency ?? 60;
  const q = Math.max(0.1, opts.q ?? 20);
  const reductionDb = Math.min(0, opts.reductionDb ?? -24);
  const harmonics = Math.max(0, Math.floor(opts.harmonics ?? 10));
  const falloff = clamp(opts.harmonicFalloff ?? 1, 0, 1);
  const mode: BiquadType = opts.mode === "notch" ? "notch" : "peaking";

  if (frequency <= 0 || harmonics === 0 || frameCount(d) === 0 || channelCount(d) === 0) {
    return cloneAudioData(d);
  }
  if (mode === "peaking" && reductionDb === 0) return cloneAudioData(d);

  // Clone once, then cascade the harmonic filters in place (one allocation,
  // not one per harmonic). Each section runs over every channel independently.
  const nyquist = d.sampleRate / 2;
  const out = cloneAudioData(d);
  for (let h = 1; h <= harmonics; h++) {
    const freq = frequency * h;
    if (freq >= nyquist) break;
    const gainDb = mode === "peaking" ? reductionDb * Math.pow(falloff, h - 1) : 0;
    const coeffs = designBiquad({ type: mode, freq, q, gainDb }, d.sampleRate);
    for (const ch of out.channels) processBiquadChannel(ch, coeffs);
  }
  return out;
}
