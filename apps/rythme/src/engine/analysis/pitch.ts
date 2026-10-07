// ─────────────────────────────────────────────────────────────
// engine/analysis/pitch — fundamental-pitch / note detection (YIN)
// ─────────────────────────────────────────────────────────────
// The note read-out behind Audition's pitch tools (Manual/Automatic Pitch
// Correction, the Frequency panel's fundamental). We use the YIN algorithm
// (de Cheveigné & Kawahara 2002): the squared difference function over lags,
// normalised by its running mean (so the period dip is at a value near 0 and
// the lag-0 trivial dip is suppressed), then the first lag under an absolute
// threshold, refined by parabolic interpolation. f0 = sampleRate / lag.

import { mixToMono } from "../audio/buffer";
import type { AudioData } from "../audio/types";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export interface PitchOptions {
  /** Lowest fundamental to look for, Hz (default 50). */
  minHz?: number;
  /** Highest fundamental to look for, Hz (default 2000). */
  maxHz?: number;
  /** Analysis window length in samples (default 2048). */
  windowSize?: number;
  /** YIN absolute threshold (default 0.15); a lag's normalised difference must drop below it. */
  threshold?: number;
}

export interface PitchResult {
  /** Estimated fundamental frequency, Hz (0 when none is found). */
  hz: number;
  /** Nearest note name (C … B), "" when no pitch. */
  note: string;
  /** Octave number of the nearest note (scientific pitch; A4 = 440 Hz). */
  octave: number;
  /** Cents away from the nearest equal-tempered note (−50 … +50). */
  cents: number;
  /** Detection confidence 0…1 (1 = a clean periodic signal). */
  confidence: number;
}

/** Map a frequency to its nearest equal-tempered note name, octave and cents. */
export function hzToNote(hz: number): { note: string; octave: number; cents: number } {
  if (hz <= 0) return { note: "", octave: 0, cents: 0 };
  const midi = 69 + 12 * Math.log2(hz / 440);
  const rounded = Math.round(midi);
  return {
    note: NOTE_NAMES[((rounded % 12) + 12) % 12],
    octave: Math.floor(rounded / 12) - 1,
    cents: Math.round((midi - rounded) * 100),
  };
}

/** YIN fundamental of one window → { hz, confidence }. */
function yin(x: Float32Array, sr: number, minHz: number, maxHz: number, threshold: number): { hz: number; confidence: number } {
  const w = x.length;
  const maxTau = Math.min(w >> 1, Math.floor(sr / minHz));
  const minTau = Math.max(2, Math.floor(sr / maxHz));
  if (maxTau <= minTau) return { hz: 0, confidence: 0 };

  // Squared difference function, then cumulative-mean-normalised difference.
  const cmnd = new Float64Array(maxTau + 1);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= maxTau; tau++) {
    let sum = 0;
    for (let j = 0; j + tau < w; j++) {
      const d = x[j] - x[j + tau];
      sum += d * d;
    }
    running += sum;
    cmnd[tau] = running > 0 ? (sum * tau) / running : 1;
  }

  // First lag under the absolute threshold (descended to its local min); else global min.
  let tau = -1;
  for (let t = minTau; t <= maxTau; t++) {
    if (cmnd[t] < threshold) {
      while (t + 1 <= maxTau && cmnd[t + 1] < cmnd[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau === -1) {
    let best = minTau;
    for (let t = minTau + 1; t <= maxTau; t++) if (cmnd[t] < cmnd[best]) best = t;
    tau = best;
  }

  // Parabolic interpolation around the chosen lag for sub-sample precision.
  let refined = tau;
  if (tau > minTau && tau < maxTau) {
    const a = cmnd[tau - 1];
    const b = cmnd[tau];
    const c = cmnd[tau + 1];
    const denom = a - 2 * b + c;
    if (denom !== 0) refined = tau + (a - c) / (2 * denom);
  }
  if (refined <= 0) return { hz: 0, confidence: 0 };
  return { hz: sr / refined, confidence: Math.max(0, Math.min(1, 1 - cmnd[tau])) };
}

/** Central analysis window of `size` samples (or the whole channel if shorter). */
function centralWindow(ch: Float32Array, size: number): Float32Array {
  if (ch.length <= size) return ch;
  const start = (ch.length - size) >> 1;
  return ch.subarray(start, start + size);
}

/** Detect the dominant fundamental pitch of a buffer and its nearest note. */
export function detectPitch(d: AudioData, opts: PitchOptions = {}): PitchResult {
  const minHz = opts.minHz ?? 50;
  const maxHz = opts.maxHz ?? 2000;
  const windowSize = Math.max(256, Math.round(opts.windowSize ?? 2048));
  const threshold = opts.threshold ?? 0.15;

  const mono = mixToMono(d).channels[0] ?? new Float32Array(0);
  if (mono.length < 2 * Math.floor(d.sampleRate / minHz)) {
    return { hz: 0, note: "", octave: 0, cents: 0, confidence: 0 }; // too short for one low-pitch period pair
  }
  const { hz, confidence } = yin(centralWindow(mono, windowSize), d.sampleRate, minHz, maxHz, threshold);
  if (hz <= 0) return { hz: 0, note: "", octave: 0, cents: 0, confidence: 0 };
  const { note, octave, cents } = hzToNote(hz);
  return { hz, note, octave, cents, confidence };
}

export interface PitchContourResult {
  /** Window centre times, seconds. */
  times: number[];
  /** Per-window fundamental, Hz (0 where none). */
  hz: number[];
  /** Per-window confidence 0…1. */
  confidence: number[];
}

/** Track the fundamental over time (the Manual Pitch Correction contour). */
export function pitchContour(d: AudioData, opts: PitchOptions & { hop?: number } = {}): PitchContourResult {
  const minHz = opts.minHz ?? 50;
  const maxHz = opts.maxHz ?? 2000;
  const windowSize = Math.max(256, Math.round(opts.windowSize ?? 2048));
  const hop = Math.max(64, Math.round(opts.hop ?? windowSize / 2));
  const threshold = opts.threshold ?? 0.15;

  const mono = mixToMono(d).channels[0] ?? new Float32Array(0);
  const times: number[] = [];
  const hz: number[] = [];
  const confidence: number[] = [];
  for (let start = 0; start + windowSize <= mono.length; start += hop) {
    const r = yin(mono.subarray(start, start + windowSize), d.sampleRate, minHz, maxHz, threshold);
    times.push((start + windowSize / 2) / d.sampleRate);
    hz.push(r.hz);
    confidence.push(r.confidence);
  }
  return { times, hz, confidence };
}
