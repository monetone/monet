// ─────────────────────────────────────────────────────────────
// engine/dsp/noise-reduction — Adobe Audition–style spectral denoise
// ─────────────────────────────────────────────────────────────
// A two-step restoration, exactly like Audition's "Noise Reduction (process)":
//
//   1. Capture Noise Print — analyse a noise-only region and gather a per-bin
//      statistical noise floor (the average magnitude spectrum across frames).
//   2. Reduce Noise — short-time Fourier transform (STFT) the signal, and for
//      every frequency bin compare its magnitude against the captured floor.
//      Bins near/under the floor are attenuated (gated) by `reduceByDb`; bins
//      well above it pass through. A soft knee, frequency smoothing and a
//      temporal release tame the "musical noise" artefacts. The frames are
//      stitched back with weighted overlap-add (WOLA).
//
// Both functions are pure `(AudioData, …) => …`; nothing mutates its input. The
// analysis reuses the engine FFT (analysis/fft, forward + inverse) and the Hann
// window (analysis/spectrum), so capture and reduction share the same scale.

import { cloneAudioData, createAudioData, mixToMono } from "../audio/buffer";
import { clamp, dbToGain } from "../audio/db";
import { channelCount, frameCount, type AudioData } from "../audio/types";
import { fft, isPow2 } from "../analysis/fft";
import { windowValue } from "../analysis/spectrum";

/** Default analysis resolution — matches Audition's typical FFT size. */
export const DEFAULT_NR_FFT_SIZE = 4096;

/**
 * A captured noise fingerprint: the statistical magnitude spectrum of a
 * noise-only region. `floor` is the average (the gate threshold reference);
 * `peak` is the loudest noise seen per bin (kept for display/diagnostics, the
 * way Audition stores low/high/average coefficients in its `.fft` print).
 */
export interface NoiseProfile {
  /** FFT size the print was captured at; reduction must use the same size. */
  fftSize: number;
  sampleRate: number;
  /** Mean noise magnitude per bin (length fftSize/2 + 1). */
  floor: Float64Array;
  /** Peak noise magnitude per bin (length fftSize/2 + 1). */
  peak: Float64Array;
  /** Number of analysis frames averaged into the print. */
  frames: number;
}

export interface NoiseReductionOptions {
  /** How much of the detected noise to remove, 0…1 (Audition "Noise Reduction"). */
  amount?: number;
  /** Attenuation applied to bins identified as noise, in dB (Audition "Reduce By"). */
  reduceByDb?: number;
  /** How far above the captured floor a bin must sit to count as signal, in dB. */
  sensitivityDb?: number;
  /** Soft-knee width above the threshold over which the gate fully opens, in dB. */
  transitionDb?: number;
  /** Frequency smoothing radius for the gain mask, in bins (Audition "Smoothing"). */
  smoothingBins?: number;
  /** Temporal release of the gain mask, 0…1 (Audition "Spectral Decay Rate"). */
  spectralDecay?: number;
  /** Analysis overlap factor: 2 (50%) or 4 (75%, default). */
  overlap?: number;
  /** Output the removed noise instead of the cleaned signal (Audition "Output Noise Only"). */
  outputNoiseOnly?: boolean;
}

/** Hann analysis/synthesis window of length n (reuses the spectrum helper). */
function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = windowValue("hann", i, n);
  return w;
}

/**
 * Capture a noise print from a noise-only buffer: the per-bin average (and
 * peak) magnitude spectrum over overlapping Hann frames. Down-mixed to mono so
 * one print drives every channel, exactly like Audition's single noise print.
 */
export function captureNoiseProfile(noise: AudioData, opts: { fftSize?: number } = {}): NoiseProfile {
  const fftSize = opts.fftSize ?? DEFAULT_NR_FFT_SIZE;
  if (!isPow2(fftSize)) throw new Error(`captureNoiseProfile: fftSize ${fftSize} must be a power of two`);

  const mono = mixToMono(noise).channels[0];
  const half = fftSize / 2 + 1;
  const floor = new Float64Array(half);
  const peak = new Float64Array(half);
  const w = hann(fftSize);
  const hop = Math.max(1, fftSize >> 2); // 75% overlap

  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);
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
      floor[k] += mag;
      if (mag > peak[k]) peak[k] = mag;
    }
    frames++;
    if (start + fftSize > mono.length) break;
  }
  if (frames > 0) for (let k = 0; k < half; k++) floor[k] /= frames;

  return { fftSize, sampleRate: noise.sampleRate, floor, peak, frames };
}

/**
 * Spectral noise reduction against a captured {@link NoiseProfile}. STFT →
 * per-bin spectral gate → ISTFT (weighted overlap-add). The output keeps the
 * input's channel count and exact frame count. With `amount: 0` it is an
 * identity STFT round-trip (used to verify reconstruction).
 */
export function reduceNoise(d: AudioData, profile: NoiseProfile, opts: NoiseReductionOptions = {}): AudioData {
  const fftSize = profile.fftSize;
  if (!isPow2(fftSize)) throw new Error(`reduceNoise: profile.fftSize ${fftSize} must be a power of two`);

  const n = frameCount(d);
  const ch = channelCount(d);
  if (n === 0 || ch === 0) return cloneAudioData(d);

  const amount = clamp(opts.amount ?? 0.9, 0, 1);
  const reduceByDb = Math.max(0, opts.reduceByDb ?? 18);
  const floorGain = dbToGain(-reduceByDb);
  const sensitivity = dbToGain(opts.sensitivityDb ?? 4); // threshold = floor × sensitivity
  const transitionDb = Math.max(1e-3, opts.transitionDb ?? 8);
  const smoothingBins = Math.max(0, Math.floor(opts.smoothingBins ?? 1));
  const decay = clamp(opts.spectralDecay ?? 0.6, 0, 0.999);
  const overlap = opts.overlap === 2 ? 2 : 4;
  const hop = Math.max(1, Math.floor(fftSize / overlap));
  const half = fftSize / 2 + 1;
  const noiseOnly = !!opts.outputNoiseOnly;

  const w = hann(fftSize);
  const out = createAudioData(ch, n, d.sampleRate);

  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);
  const rawGain = new Float64Array(half);
  const gainMask = new Float64Array(half);
  const prevGain = new Float64Array(half);

  // Pad the signal front and back by a full window so weighted overlap-add
  // reconstructs every original sample exactly (no Hann edge roll-off loss).
  const pad = fftSize;
  const plen = n + pad * 2;

  for (let c = 0; c < ch; c++) {
    const src = d.channels[c];
    const acc = new Float64Array(plen);
    const norm = new Float64Array(plen);
    let firstFrame = true;

    for (let start = 0; start + fftSize <= plen; start += hop) {
      re.fill(0);
      im.fill(0);
      for (let i = 0; i < fftSize; i++) {
        const idx = start + i - pad;
        const s = idx >= 0 && idx < n ? src[idx] : 0;
        re[i] = s * w[i];
      }
      fft(re, im, false);

      // Per-bin raw gain from the magnitude's signal-to-noise ratio.
      for (let k = 0; k < half; k++) {
        const mag = Math.hypot(re[k], im[k]);
        const thresh = profile.floor[k] * sensitivity;
        if (thresh <= 0) {
          rawGain[k] = 1; // no noise captured here → pass through untouched
        } else if (mag <= thresh) {
          rawGain[k] = floorGain;
        } else {
          const overDb = 20 * Math.log10(mag / thresh);
          const t = overDb >= transitionDb ? 1 : overDb / transitionDb;
          rawGain[k] = dbToGain(-reduceByDb * (1 - t)); // soft knee floorGain → 1
        }
      }

      // Frequency smoothing of the gain mask (Audition "Smoothing").
      if (smoothingBins > 0) {
        for (let k = 0; k < half; k++) {
          let sum = 0;
          let cnt = 0;
          const lo = Math.max(0, k - smoothingBins);
          const hi = Math.min(half - 1, k + smoothingBins);
          for (let j = lo; j <= hi; j++) {
            sum += rawGain[j];
            cnt++;
          }
          gainMask[k] = sum / cnt;
        }
      } else {
        gainMask.set(rawGain);
      }

      // Temporal release (Audition "Spectral Decay Rate"): open instantly,
      // close slowly. Seed from the first frame so steady noise is fully gated
      // from the very start rather than leaking while the state settles.
      for (let k = 0; k < half; k++) {
        const target = gainMask[k];
        const held = firstFrame || target >= prevGain[k] ? target : prevGain[k] * decay + target * (1 - decay);
        prevGain[k] = held;

        const g = 1 - amount * (1 - held); // blend by reduction amount
        re[k] *= g;
        im[k] *= g;
        const mk = fftSize - k; // mirror the conjugate bin so ISTFT stays real
        if (mk < fftSize && mk !== k) {
          re[mk] *= g;
          im[mk] *= g;
        }
      }
      firstFrame = false;

      fft(re, im, true); // inverse → real time-domain frame in `re`
      for (let i = 0; i < fftSize; i++) {
        const p = start + i;
        acc[p] += re[i] * w[i];
        norm[p] += w[i] * w[i];
      }
    }

    const dst = out.channels[c];
    for (let i = 0; i < n; i++) {
      const p = i + pad;
      const denoised = norm[p] > 1e-8 ? acc[p] / norm[p] : 0;
      dst[i] = noiseOnly ? src[i] - denoised : denoised;
    }
  }

  return out;
}
