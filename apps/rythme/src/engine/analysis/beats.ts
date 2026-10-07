// ─────────────────────────────────────────────────────────────
// engine/analysis/beats — onset / beat detection + tempo (BPM)
// ─────────────────────────────────────────────────────────────
// Audition's "Generate markers from beats" / tempo estimate: find rhythmic
// onsets and the pace they imply. We use an energy-flux onset detector — frame
// the signal, take the half-wave-rectified rise in per-frame energy (a spike at
// every transient), and peak-pick the spikes that stand well above the average
// with a refractory gap so one hit isn't counted twice. The tempo is the median
// inter-onset interval folded into a musical range.

import { mixToMono } from "../audio/buffer";
import type { AudioData } from "../audio/types";

export interface BeatDetectionOptions {
  /** Analysis hop in samples (default 256). */
  hop?: number;
  /** Minimum gap between detected onsets, ms (default 120). */
  minGapMs?: number;
  /** Onset sensitivity: a frame is an onset if its flux exceeds this × the mean flux (default 3). */
  sensitivity?: number;
}

export interface BeatDetectionResult {
  /** Onset (beat) times in seconds, ascending. */
  beats: number[];
  /** Estimated tempo in BPM (0 when fewer than two beats are found). */
  bpm: number;
}

/** Detect rhythmic onsets and estimate the tempo. The input is not mutated. */
export function detectBeats(d: AudioData, opts: BeatDetectionOptions = {}): BeatDetectionResult {
  const sr = d.sampleRate;
  const hop = Math.max(64, Math.round(opts.hop ?? 256));
  const sensitivity = opts.sensitivity ?? 3;
  const minGapFrames = Math.max(1, Math.round(((opts.minGapMs ?? 120) / 1000) * (sr / hop)));

  const mono = mixToMono(d).channels[0] ?? new Float32Array(0);
  const frames = Math.floor(mono.length / hop);
  if (frames < 2) return { beats: [], bpm: 0 };

  // Per-frame energy, then half-wave-rectified energy flux (a rise = an onset).
  // flux[0] measures the rise out of pre-signal silence so an onset at t=0 counts.
  const flux = new Float64Array(frames);
  let prev = 0;
  let sum = 0;
  let max = 0;
  for (let f = 0; f < frames; f++) {
    let e = 0;
    const base = f * hop;
    for (let i = 0; i < hop; i++) e += mono[base + i] * mono[base + i];
    const rise = e - prev;
    const v = rise > 0 ? rise : 0;
    flux[f] = v;
    sum += v;
    if (v > max) max = v;
    prev = e;
  }
  if (max <= 0) return { beats: [], bpm: 0 };

  const mean = sum / frames;
  const threshold = Math.max(sensitivity * mean, 0.25 * max);

  // Peak-pick local maxima above the threshold, honouring the refractory gap.
  const beats: number[] = [];
  let lastFrame = -minGapFrames;
  for (let f = 0; f < frames; f++) {
    const isPeak = flux[f] >= (f > 0 ? flux[f - 1] : 0) && flux[f] >= (f < frames - 1 ? flux[f + 1] : 0);
    if (flux[f] >= threshold && isPeak && f - lastFrame >= minGapFrames) {
      beats.push((f * hop) / sr);
      lastFrame = f;
    }
  }

  return { beats, bpm: tempoFromBeats(beats) };
}

/** Median inter-onset interval → BPM, folded into a 60–200 musical range. */
function tempoFromBeats(beats: number[]): number {
  if (beats.length < 2) return 0;
  const iois: number[] = [];
  for (let i = 1; i < beats.length; i++) iois.push(beats[i] - beats[i - 1]);
  iois.sort((a, b) => a - b);
  const median = iois[Math.floor(iois.length / 2)];
  if (median <= 0) return 0;
  let bpm = 60 / median;
  while (bpm > 0 && bpm < 60) bpm *= 2;
  while (bpm > 200) bpm /= 2;
  return Math.round(bpm * 10) / 10;
}
