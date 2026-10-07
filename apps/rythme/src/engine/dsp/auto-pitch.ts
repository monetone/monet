// ─────────────────────────────────────────────────────────────
// engine/dsp/auto-pitch — Adobe Audition–style Automatic Pitch Correction
// ─────────────────────────────────────────────────────────────
// Detects the pitch of a (mostly monophonic, sustained) selection and snaps it
// toward the nearest equal-tempered semitone. `detectPitch` is a time-domain
// autocorrelation fundamental estimator (the new primitive); `autoPitchCorrect`
// finds the nearest semitone relative to a reference A and shifts the whole
// selection by the cents error — scaled by `strength` — using the existing
// duration-preserving phase-vocoder pitchShift. Distinct from the fixed-amount
// Pitch Shifter (no detection) and the ramped Pitch Bender. Pure
// `(AudioData, opts) => AudioData`; the input is never mutated.

import { cloneAudioData, mixToMono } from "../audio/buffer";
import { clamp } from "../audio/db";
import { frameCount, type AudioData } from "../audio/types";
import { pitchShift } from "./stretch";

export interface PitchDetectOptions {
  /** Lowest fundamental to consider, Hz. Default 50. */
  minHz?: number;
  /** Highest fundamental to consider, Hz. Default 2000. */
  maxHz?: number;
}

/** YIN difference-function threshold below which a lag counts as a true period. */
const YIN_THRESHOLD = 0.15;

/**
 * Estimate the dominant fundamental frequency (Hz) of the mono mix, or 0 when no
 * clear pitch is present (e.g. broadband noise). Uses the YIN algorithm (de
 * Cheveigné & Kawahara): a cumulative-mean-normalised difference function picks
 * the lowest lag whose periodicity is strong enough — robust across the whole
 * [minHz, maxHz] range and free of the octave / low-frequency errors that a raw
 * autocorrelation peak suffers. Sub-sample accurate via parabolic interpolation.
 *
 * @remarks Assumes mostly monophonic material; on dense polyphony the dominant
 * partial wins. Intended for tuning sustained single notes.
 */
export function detectPitch(d: AudioData, opts: PitchDetectOptions = {}): number {
  const sr = d.sampleRate;
  const mono = mixToMono(d).channels[0];
  const total = mono.length;
  if (total < 64) return 0;

  // Analyse a settled window (skip the first 10%, cap at ~120 ms).
  const from = Math.floor(total * 0.1);
  const avail = total - from;
  const minHz = Math.max(1, opts.minHz ?? 50);
  const maxHz = Math.min(sr / 2 - 1, opts.maxHz ?? 2000);
  // Cap maxLag so the difference window keeps a healthy, constant term count.
  const maxLag = Math.min(Math.floor(avail / 2), Math.ceil(sr / minHz));
  const minLag = Math.max(2, Math.floor(sr / maxHz));
  if (maxLag <= minLag) return 0;
  const W = avail - maxLag; // difference-window length — the SAME for every lag (no term-count bias)
  if (W < 64) return 0;

  // YIN difference function d(τ) and its cumulative-mean normalisation d'(τ).
  const dprime = new Float64Array(maxLag + 1);
  dprime[0] = 1;
  let runningSum = 0;
  for (let lag = 1; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < W; i++) {
      const diff = mono[from + i] - mono[from + i + lag];
      sum += diff * diff;
    }
    runningSum += sum;
    dprime[lag] = runningSum > 0 ? (sum * lag) / runningSum : 1;
  }

  // Absolute-threshold pick: the smallest lag (≥ minLag) that dips below the
  // threshold, then descend into its local minimum. Noise never dips → no pitch.
  let chosen = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (dprime[lag] < YIN_THRESHOLD) {
      let t = lag;
      while (t + 1 <= maxLag && dprime[t + 1] < dprime[t]) t++;
      chosen = t;
      break;
    }
  }
  if (chosen < 0) return 0;

  // Parabolic interpolation of the minimum for sub-sample precision.
  const ym = chosen > 1 ? dprime[chosen - 1] : dprime[chosen];
  const y1 = dprime[chosen];
  const yp = chosen < maxLag ? dprime[chosen + 1] : dprime[chosen];
  const denom = ym - 2 * y1 + yp;
  const offset = denom !== 0 ? (0.5 * (ym - yp)) / denom : 0;
  const tau = chosen + clamp(offset, -1, 1);
  return tau > 0 ? sr / tau : 0;
}

/** Corrections below this (semitones, ~3 cents) are left alone — see autoPitchCorrect. */
const CORRECTION_DEADZONE_SEMITONES = 0.03;

export interface AutoPitchOptions extends PitchDetectOptions {
  /** Reference tuning for A, Hz. Default 440. */
  referenceHz?: number;
  /** Correction strength 0…1 (1 = full snap to the nearest semitone). Default 1. */
  strength?: number;
}

/**
 * Snap the detected pitch toward the nearest equal-tempered semitone. With no
 * detectable pitch the input is returned unchanged. Frame count is preserved
 * (duration-preserving shift) and the input is not mutated.
 */
export function autoPitchCorrect(d: AudioData, opts: AutoPitchOptions = {}): AudioData {
  if (frameCount(d) === 0) return cloneAudioData(d);
  const f0 = detectPitch(d, opts);
  if (f0 <= 0) return cloneAudioData(d);

  const ref = opts.referenceHz ?? 440;
  const strength = clamp(opts.strength ?? 1, 0, 1);
  const semisFromRef = 12 * Math.log2(f0 / ref);
  const errorSemis = Math.round(semisFromRef) - semisFromRef; // shift to reach the semitone
  const shift = errorSemis * strength;
  // Deadzone: a correction smaller than ~3 cents is inaudible and running the
  // phase vocoder for it would add more artefact than it fixes — leave it alone.
  if (Math.abs(shift) < CORRECTION_DEADZONE_SEMITONES) return cloneAudioData(d);
  return pitchShift(d, shift);
}
