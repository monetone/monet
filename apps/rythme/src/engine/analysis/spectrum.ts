// ─────────────────────────────────────────────────────────────
// engine/analysis/spectrum — windowed magnitude spectrum
// ─────────────────────────────────────────────────────────────

import { mixToMono } from "../audio/buffer";
import { gainToDb } from "../audio/db";
import { frameCount, type AudioData } from "../audio/types";
import { fft, nextPow2 } from "./fft";

export type WindowFn = "hann" | "hamming" | "blackman" | "rectangular";

/** Window coefficient at index i of N. */
export function windowValue(fn: WindowFn, i: number, N: number): number {
  const x = (2 * Math.PI * i) / (N - 1);
  switch (fn) {
    case "rectangular":
      return 1;
    case "hamming":
      return 0.54 - 0.46 * Math.cos(x);
    case "blackman":
      return 0.42 - 0.5 * Math.cos(x) + 0.08 * Math.cos(2 * x);
    case "hann":
    default:
      return 0.5 * (1 - Math.cos(x));
  }
}

export interface SpectrumResult {
  /** Bin center frequencies in Hz (length fftSize/2+1). */
  freqs: Float64Array;
  /** Average magnitudes in dBFS, normalized so a full-scale sine reads ~0 dB (the "Scan" curve). */
  db: Float64Array;
  /** Peak-hold magnitudes in dBFS: the loudest each bin ever got across the frames (the "Hold" curve). */
  peakDb: Float64Array;
  fftSize: number;
}

/**
 * Average magnitude spectrum (dBFS) of a buffer using overlapping windowed
 * frames (Welch-style averaging). Input is down-mixed to mono.
 */
export function spectrum(
  d: AudioData,
  opts: { fftSize?: number; window?: WindowFn; hop?: number } = {},
): SpectrumResult {
  const mono = mixToMono(d).channels[0];
  const fftSize = opts.fftSize ?? Math.min(4096, nextPow2(Math.max(256, frameCount(d))));
  const win = opts.window ?? "hann";
  const hop = opts.hop ?? fftSize / 2;
  const half = fftSize / 2 + 1;

  // window normalization (coherent gain) so amplitudes are calibrated
  let winSum = 0;
  const w = new Float64Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    w[i] = windowValue(win, i, fftSize);
    winSum += w[i];
  }
  const norm = winSum / 2; // full-scale sine → 0 dB

  const acc = new Float64Array(half);
  const peak = new Float64Array(half); // loudest each bin ever got (peak-hold)
  let frames = 0;
  for (let start = 0; start + fftSize <= mono.length || (frames === 0 && start === 0); start += hop) {
    const re = new Float64Array(fftSize);
    const im = new Float64Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
      const s = start + i < mono.length ? mono[start + i] : 0;
      re[i] = s * w[i];
    }
    fft(re, im, false);
    for (let i = 0; i < half; i++) {
      const mag = Math.hypot(re[i], im[i]);
      acc[i] += mag;
      if (mag > peak[i]) peak[i] = mag;
    }
    frames++;
    if (start + fftSize > mono.length) break;
  }

  const freqs = new Float64Array(half);
  const db = new Float64Array(half);
  const peakDb = new Float64Array(half);
  for (let i = 0; i < half; i++) {
    freqs[i] = (i * d.sampleRate) / fftSize;
    db[i] = gainToDb(acc[i] / (frames || 1) / norm);
    peakDb[i] = gainToDb(peak[i] / norm);
  }
  return { freqs, db, peakDb, fftSize };
}
