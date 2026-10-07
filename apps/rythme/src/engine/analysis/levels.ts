// ─────────────────────────────────────────────────────────────
// engine/analysis/levels — peak / RMS / DC measurement
// ─────────────────────────────────────────────────────────────

import { gainToDb } from "../audio/db";
import type { AudioData } from "../audio/types";

export interface LevelStats {
  /** Peak sample magnitude, linear and dBFS. */
  peak: number;
  peakDb: number;
  /** RMS, linear and dBFS. */
  rms: number;
  rmsDb: number;
  /** Mean (DC) offset, linear. */
  dcOffset: number;
  /** Count of samples at or beyond full scale. */
  clippedSamples: number;
}

/** Per-channel level statistics. */
export function channelStats(ch: Float32Array): LevelStats {
  let peak = 0;
  let sumSq = 0;
  let sum = 0;
  let clipped = 0;
  for (let i = 0; i < ch.length; i++) {
    const v = ch[i];
    const a = Math.abs(v);
    if (a > peak) peak = a;
    sumSq += v * v;
    sum += v;
    if (a >= 0.999969) clipped++; // ~ -0.0003 dB, 16-bit full scale
  }
  const rms = ch.length ? Math.sqrt(sumSq / ch.length) : 0;
  return {
    peak,
    peakDb: gainToDb(peak),
    rms,
    rmsDb: gainToDb(rms),
    dcOffset: ch.length ? sum / ch.length : 0,
    clippedSamples: clipped,
  };
}

/** Whole-buffer stats (max peak, overall RMS, etc. across channels). */
export function analyzeLevels(d: AudioData): LevelStats {
  let peak = 0;
  let sumSq = 0;
  let sum = 0;
  let clipped = 0;
  let count = 0;
  for (const ch of d.channels) {
    const s = channelStats(ch);
    peak = Math.max(peak, s.peak);
    sumSq += s.rms * s.rms * ch.length;
    sum += s.dcOffset * ch.length;
    clipped += s.clippedSamples;
    count += ch.length;
  }
  const rms = count ? Math.sqrt(sumSq / count) : 0;
  return {
    peak,
    peakDb: gainToDb(peak),
    rms,
    rmsDb: gainToDb(rms),
    dcOffset: count ? sum / count : 0,
    clippedSamples: clipped,
  };
}

/** Short-window RMS envelope (linear), one value per `windowSamples`. */
export function rmsEnvelope(ch: Float32Array, windowSamples: number): Float32Array {
  const w = Math.max(1, Math.floor(windowSamples));
  const out = new Float32Array(Math.ceil(ch.length / w));
  for (let b = 0; b < out.length; b++) {
    let sum = 0;
    const start = b * w;
    const end = Math.min(ch.length, start + w);
    for (let i = start; i < end; i++) sum += ch[i] * ch[i];
    out[b] = Math.sqrt(sum / (end - start || 1));
  }
  return out;
}

/** Convenience: peak dBFS of the whole buffer. */
export function peakDb(d: AudioData): number {
  return analyzeLevels(d).peakDb;
}

/** Convenience: RMS dBFS of the whole buffer. */
export function rmsDb(d: AudioData): number {
  return analyzeLevels(d).rmsDb;
}
