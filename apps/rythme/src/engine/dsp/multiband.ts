// ─────────────────────────────────────────────────────────────
// engine/dsp/multiband — Adobe Audition–style Multiband Compressor
// ─────────────────────────────────────────────────────────────
// Splits the spectrum into frequency bands at the crossover points, compresses
// each band on its own dynamics, then sums them back — the mastering staple,
// because bass, body and air each want different compression. Bands are split
// with a Linkwitz-Riley–style tree (cascaded Butterworth low/high passes, ~4th
// order), so each band is properly band-limited (per-band processing stays
// isolated) and the bands sum back to a flat magnitude response. An optional
// global Hard Limiter caps the result, matching Audition's per-band compressors
// + master limiter layout.
//
// Notes: upper bands carry more cascaded high-pass stages (more group delay) by
// design; magnitude still reconstructs flat. Heavy per-band makeup can clip a
// band before the sum (compress hard-clips at ±1) — use the master `limiter` to
// hold the final ceiling.
//
// Pure `(AudioData, opts) => AudioData`; the input is never mutated.

import { cloneAudioData } from "../audio/buffer";
import { channelCount, frameCount, type AudioData } from "../audio/types";
import { compress, type CompressorOptions } from "./dynamics";
import { highpass, lowpass } from "./filter";
import { hardLimiter, type HardLimiterOptions } from "./limiter";

export interface MultibandCompressorOptions {
  /** Crossover frequencies in Hz (ascending); N crossovers → N+1 bands. Default [120, 700, 5000]. */
  crossover?: number[];
  /** Per-band compressor settings, low→high; a missing entry leaves that band uncompressed. */
  bands?: CompressorOptions[];
  /** Crossover filter steepness in ~12 dB/oct passes (default 2 → ~Linkwitz-Riley 4th order). */
  crossoverPasses?: number;
  /** Optional global peak limiter applied to the summed output (Audition's master limiter). */
  limiter?: HardLimiterOptions | null;
}

/** Sum a set of same-shaped buffers into a new buffer. */
function sumBuffers(parts: AudioData[]): AudioData {
  const out = cloneAudioData(parts[0]);
  for (let p = 1; p < parts.length; p++) {
    const src = parts[p];
    for (let c = 0; c < out.channels.length; c++) {
      const oc = out.channels[c];
      const sc = src.channels[c];
      for (let i = 0; i < oc.length; i++) oc[i] += sc[i];
    }
  }
  return out;
}

/**
 * Multiband compression: split at the crossovers, compress each band, sum, then
 * optionally limit. The output keeps the input's channel and frame count.
 */
export function multibandCompress(d: AudioData, opts: MultibandCompressorOptions = {}): AudioData {
  if (frameCount(d) === 0 || channelCount(d) === 0) return cloneAudioData(d);

  const nyquist = d.sampleRate / 2;
  const crossover = (opts.crossover ?? [120, 700, 5000])
    .filter((f) => f > 0 && f < nyquist)
    .sort((a, b) => a - b);
  const passes = Math.max(1, opts.crossoverPasses ?? 2);

  // Linkwitz-Riley crossover tree: peel off each band with a low-pass while
  // carrying the high-passed remainder forward, so every band is band-limited
  // on both edges and the set sums to a flat magnitude.
  let high = cloneAudioData(d);
  const bands: AudioData[] = [];
  for (const fc of crossover) {
    bands.push(lowpass(high, fc, Math.SQRT1_2, passes));
    high = highpass(high, fc, Math.SQRT1_2, passes);
  }
  bands.push(high);

  // Compress each band on its own settings (a missing entry = pass-through).
  const bandOpts = opts.bands ?? [];
  const processed = bands.map((b, i) => (bandOpts[i] ? compress(b, bandOpts[i]) : b));

  let out = sumBuffers(processed);
  if (opts.limiter) out = hardLimiter(out, opts.limiter);
  return out;
}
