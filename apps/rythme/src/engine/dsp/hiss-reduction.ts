// ─────────────────────────────────────────────────────────────
// engine/dsp/hiss-reduction — Adobe Audition–style Hiss Reduction
// ─────────────────────────────────────────────────────────────
// Removes broadband, low-level, stationary hiss/tape noise WITHOUT a separately
// captured noise print. It estimates a per-frequency noise floor straight from
// the audio — the floor sits where each frequency bin spends most of its quiet
// time — then feeds that floor into the engine's proven WOLA spectral-reduction
// pipeline (reduceNoise), which attenuates bins at or below the floor and leaves
// louder signal above it intact. The floor is a low per-bin percentile of the
// STFT magnitude over time (minimum-statistics style), so an intermittent signal
// (speech, an instrument) reveals the hiss in its gaps. Distinct from Noise
// Reduction, which needs a user-selected noise-only region. Pure
// `(AudioData, opts) => AudioData`; the input is never mutated.

import { cloneAudioData, mixToMono } from "../audio/buffer";
import { clamp } from "../audio/db";
import { channelCount, frameCount, type AudioData } from "../audio/types";
import { fft, isPow2 } from "../analysis/fft";
import { windowValue } from "../analysis/spectrum";
import { DEFAULT_NR_FFT_SIZE, reduceNoise, type NoiseProfile } from "./noise-reduction";

export interface HissReductionOptions {
  /** STFT size (power of two). Default 4096. */
  fftSize?: number;
  /** Attenuation applied to bins identified as hiss, in dB. Default 20. */
  reduceByDb?: number;
  /** How much of the detected hiss to remove, 0…1. Default 0.9. */
  amount?: number;
  /** How far above the floor a bin must sit to count as signal, in dB. Default 4. */
  sensitivityDb?: number;
  /** Which per-bin magnitude percentile (0…1) is taken as the noise floor. Default 0.2. */
  floorPercentile?: number;
}

/** Hann window of length n (matches the noise-reduction analysis scale). */
function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = windowValue("hann", i, n);
  return w;
}

/** Linear-interpolated p-th percentile (0…1) of a sorted, non-empty array. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const pos = p * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(sorted.length - 1, lo + 1);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Estimate the per-frequency noise floor adaptively: the `floorPercentile` of
 * each STFT bin's magnitude over time. Returns a {@link NoiseProfile} at the
 * same Hann/hop/fftSize scale as {@link captureNoiseProfile}, so it drops
 * straight into {@link reduceNoise}. `floor` is the percentile, `peak` the max.
 */
export function estimateHissFloor(d: AudioData, opts: { fftSize?: number; floorPercentile?: number } = {}): NoiseProfile {
  const fftSize = opts.fftSize ?? DEFAULT_NR_FFT_SIZE;
  if (!isPow2(fftSize)) throw new Error(`estimateHissFloor: fftSize ${fftSize} must be a power of two`);

  const mono = mixToMono(d).channels[0];
  const half = fftSize / 2 + 1;
  const w = hann(fftSize);
  const hop = Math.max(1, fftSize >> 2); // 75% overlap
  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);
  const perBin: number[][] = Array.from({ length: half }, () => []);
  const peak = new Float64Array(half);

  let frames = 0;
  for (let start = 0; start + fftSize <= mono.length || (frames === 0 && start === 0); start += hop) {
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < fftSize; i++) {
      const idx = start + i;
      re[i] = (idx < mono.length ? mono[idx] : 0) * w[i];
    }
    fft(re, im, false);
    for (let k = 0; k < half; k++) {
      const mag = Math.hypot(re[k], im[k]);
      perBin[k].push(mag);
      if (mag > peak[k]) peak[k] = mag;
    }
    frames++;
    if (start + fftSize > mono.length) break;
  }

  const p = clamp(opts.floorPercentile ?? 0.2, 0, 1);
  const floor = new Float64Array(half);
  for (let k = 0; k < half; k++) {
    const arr = perBin[k].sort((a, b) => a - b); // in-place ok — perBin[k] is single-use
    floor[k] = percentile(arr, p);
  }
  return { fftSize, sampleRate: d.sampleRate, floor, peak, frames };
}

/**
 * Reduce broadband hiss using an adaptively-estimated noise floor. Frame count
 * is preserved and the input is not mutated.
 *
 * @remarks Because the floor is read from each frequency's quiet moments, a
 * perfectly continuous tone (no gaps) is indistinguishable from steady noise at
 * its frequency and will be attenuated along with the hiss. For material with no
 * quiet periods, use Noise Reduction with an explicit noise print instead.
 */
export function hissReduction(d: AudioData, opts: HissReductionOptions = {}): AudioData {
  if (frameCount(d) === 0 || channelCount(d) === 0) return cloneAudioData(d);
  const fftSize = opts.fftSize ?? DEFAULT_NR_FFT_SIZE;
  const profile = estimateHissFloor(d, { fftSize, floorPercentile: opts.floorPercentile });
  return reduceNoise(d, profile, {
    reduceByDb: opts.reduceByDb ?? 20,
    amount: opts.amount ?? 0.9,
    sensitivityDb: opts.sensitivityDb ?? 4,
  });
}
