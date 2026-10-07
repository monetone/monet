// ─────────────────────────────────────────────────────────────
// engine/analysis/spectrogram — Adobe Audition–style Spectral Frequency Display
// ─────────────────────────────────────────────────────────────
// Audition's signature view: instead of amplitude-vs-time (the waveform), it
// shows *which frequencies* are present and how strongly, as they change over
// time — bass at the bottom, treble at the top, brighter = louder. That is a
// short-time Fourier transform: slide a window along the signal and take the
// magnitude spectrum of each frame, giving a time × frequency × amplitude matrix
// you can paint as a heat-map. This is the per-frame counterpart to `spectrum`,
// which averages all the frames into one curve. Pure measurement; never mutates.

import { mixToMono } from "../audio/buffer";
import { gainToDb } from "../audio/db";
import { type AudioData } from "../audio/types";
import { fft, nextPow2 } from "./fft";
import { windowValue, type WindowFn } from "./spectrum";

export interface SpectrogramResult {
  /** Bin centre frequencies in Hz (length `bins`). */
  freqs: Float64Array;
  /** Frame centre times in seconds (length `frames`). */
  times: Float64Array;
  /** Number of time frames. */
  frames: number;
  /** Number of frequency bins (fftSize/2 + 1). */
  bins: number;
  fftSize: number;
  sampleRate: number;
  /** Per-frame magnitude in dBFS, row-major: `db[frame * bins + bin]`, floored at `minDb`. */
  db: Float64Array;
  /** The clamp floor and the loudest magnitude seen, in dBFS (for colour-scaling). */
  minDb: number;
  maxDb: number;
}

export interface SpectrogramOptions {
  /** FFT size (power of two). Default = nextPow2 clamped to [256, 2048]. */
  fftSize?: number;
  /** Analysis window. Default "hann". */
  window?: WindowFn;
  /** Hop between frames in samples. Default fftSize/4 (75% overlap). */
  hop?: number;
  /** Lower clamp for the dB values. Default −120. */
  minDb?: number;
}

/**
 * Compute a spectrogram (STFT magnitude matrix) of the buffer, down-mixed to
 * mono. A full-scale sine reads ~0 dB at its bin (coherent-gain calibrated).
 */
export function spectrogram(d: AudioData, opts: SpectrogramOptions = {}): SpectrogramResult {
  const mono = mixToMono(d).channels[0];
  const n = mono.length;
  const fftSize = opts.fftSize ?? Math.min(2048, Math.max(256, nextPow2(Math.max(256, n))));
  const win = opts.window ?? "hann";
  const hop = Math.max(1, opts.hop ?? fftSize >> 2);
  const minDb = opts.minDb ?? -120;
  const bins = fftSize / 2 + 1;

  // Coherent-gain window normalization so a full-scale sine reads 0 dB.
  let winSum = 0;
  const w = new Float64Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    w[i] = windowValue(win, i, fftSize);
    winSum += w[i];
  }
  const norm = winSum / 2;

  const frames = n >= fftSize ? Math.floor((n - fftSize) / hop) + 1 : 1;
  const db = new Float64Array(frames * bins);
  const times = new Float64Array(frames);
  const freqs = new Float64Array(bins);
  for (let i = 0; i < bins; i++) freqs[i] = (i * d.sampleRate) / fftSize;

  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);
  let maxDb = minDb;
  for (let f = 0; f < frames; f++) {
    const start = f * hop;
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < fftSize; i++) re[i] = (start + i < n ? mono[start + i] : 0) * w[i];
    fft(re, im, false);
    times[f] = (start + fftSize / 2) / d.sampleRate;
    const row = f * bins;
    for (let i = 0; i < bins; i++) {
      const value = Math.max(minDb, gainToDb(Math.hypot(re[i], im[i]) / norm));
      db[row + i] = value;
      if (value > maxDb) maxDb = value;
    }
  }

  return { freqs, times, frames, bins, fftSize, sampleRate: d.sampleRate, db, minDb, maxDb };
}

/** The dominant (loudest-bin) frequency of each frame, in Hz — handy for tests / summaries. */
export function spectrogramPeakTrack(s: SpectrogramResult): Float64Array {
  const out = new Float64Array(s.frames);
  for (let f = 0; f < s.frames; f++) {
    const row = f * s.bins;
    let best = -Infinity;
    let bestBin = 0;
    for (let i = 0; i < s.bins; i++) {
      if (s.db[row + i] > best) {
        best = s.db[row + i];
        bestBin = i;
      }
    }
    out[f] = s.freqs[bestBin];
  }
  return out;
}
