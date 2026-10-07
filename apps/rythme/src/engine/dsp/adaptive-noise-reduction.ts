// ─────────────────────────────────────────────────────────────
// engine/dsp/adaptive-noise-reduction — Audition-style Adaptive Noise Reduction
// ─────────────────────────────────────────────────────────────
// Reduces changing/broadband background noise WITHOUT a captured print and,
// unlike Hiss Reduction (one static per-bin floor over the whole clip), it
// re-estimates the floor CONTINUOUSLY: a per-bin minimum follower with a fast
// track-down and a slow rise latches onto each frequency's quiet moments and
// climbs slowly when the noise gets louder, so it follows non-stationary noise.
// A WOLA STFT (Hann, 75% overlap, front/back padded) gates each bin at/below the
// adaptive floor and overlap-adds the result. Pure `(AudioData, opts) =>
// AudioData`; the input is never mutated.

import { cloneAudioData, createAudioData } from "../audio/buffer";
import { clamp, dbToGain } from "../audio/db";
import { channelCount, frameCount, type AudioData } from "../audio/types";
import { fft, isPow2 } from "../analysis/fft";
import { windowValue } from "../analysis/spectrum";
import { DEFAULT_NR_FFT_SIZE } from "./noise-reduction";

export interface AdaptiveNoiseReductionOptions {
  /** STFT size (power of two). Default 4096. */
  fftSize?: number;
  /** Attenuation applied to bins identified as noise, in dB. Default 18. */
  reduceByDb?: number;
  /** How far above the adaptive floor a bin must sit to count as signal, dB. Default 6. */
  sensitivityDb?: number;
  /** Fast track-down time constant of the floor follower, ms. Default 150. */
  downMs?: number;
  /** Slow rise time constant (how fast the floor adapts up to louder noise), ms. Default 1000. */
  adaptMs?: number;
  /** How much of the detected noise to remove, 0…1. Default 0.9. */
  amount?: number;
  /** Soft-knee width above the threshold over which the gate fully opens, dB. Default 8. */
  transitionDb?: number;
  /** Temporal release of the gain mask, 0…1. Default 0.6. */
  spectralDecay?: number;
}

/** Hann window of length n. */
function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = windowValue("hann", i, n);
  return w;
}

/**
 * Adaptive noise reduction with a per-frame, per-bin adaptive noise floor. Frame
 * count is preserved and the input is not mutated.
 *
 * @remarks With no captured print the floor self-seeds from the first analysis
 * hop (~one window), so the very start is briefly over-attenuated while the
 * follower settles — apply to clips with a short lead-in for an artefact-free onset.
 */
export function adaptiveNoiseReduction(d: AudioData, opts: AdaptiveNoiseReductionOptions = {}): AudioData {
  const fftSize = opts.fftSize ?? DEFAULT_NR_FFT_SIZE;
  if (!isPow2(fftSize)) throw new Error(`adaptiveNoiseReduction: fftSize ${fftSize} must be a power of two`);

  const n = frameCount(d);
  const ch = channelCount(d);
  if (n === 0 || ch === 0) return cloneAudioData(d);

  const reduceByDb = Math.max(0, opts.reduceByDb ?? 18);
  const floorGain = dbToGain(-reduceByDb);
  const sensitivity = dbToGain(opts.sensitivityDb ?? 10);
  const amount = clamp(opts.amount ?? 0.9, 0, 1);
  const transitionDb = Math.max(1e-3, opts.transitionDb ?? 8);
  const decay = clamp(opts.spectralDecay ?? 0.6, 0, 0.999);
  const hop = Math.max(1, fftSize >> 2); // 75% overlap
  const half = fftSize / 2 + 1;
  const sr = d.sampleRate;

  // Floor-follower coefficients (per analysis hop): fast down, slow up.
  const hopSec = hop / sr;
  const downCoef = Math.exp(-hopSec / (Math.max(1, opts.downMs ?? 150) / 1000));
  const upCoef = Math.exp(-hopSec / (Math.max(1, opts.adaptMs ?? 1000) / 1000));
  const pCoef = Math.exp(-hopSec / 0.05); // ~50 ms power smoothing

  const w = hann(fftSize);
  const out = createAudioData(ch, n, sr);
  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);
  const prevGain = new Float64Array(half);
  const smP = new Float64Array(half); // smoothed power per bin
  const floorMag = new Float64Array(half); // adaptive noise floor (magnitude)

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

      for (let k = 0; k < half; k++) {
        const mag = Math.hypot(re[k], im[k]);
        // Smooth the power, then track the adaptive floor: fast down, slow up.
        smP[k] = firstFrame ? mag * mag : pCoef * smP[k] + (1 - pCoef) * mag * mag;
        const curMag = Math.sqrt(smP[k]);
        if (firstFrame) floorMag[k] = curMag;
        else if (curMag < floorMag[k]) floorMag[k] = downCoef * floorMag[k] + (1 - downCoef) * curMag;
        else floorMag[k] = upCoef * floorMag[k] + (1 - upCoef) * curMag;

        const thresh = floorMag[k] * sensitivity;
        let rawGain: number;
        if (thresh <= 0) {
          rawGain = 1;
        } else if (mag <= thresh) {
          rawGain = floorGain;
        } else {
          const overDb = 20 * Math.log10(mag / thresh);
          const t = overDb >= transitionDb ? 1 : overDb / transitionDb;
          rawGain = dbToGain(-reduceByDb * (1 - t));
        }

        // Temporal release: open instantly, close slowly.
        const held = firstFrame || rawGain >= prevGain[k] ? rawGain : prevGain[k] * decay + rawGain * (1 - decay);
        prevGain[k] = held;

        const g = 1 - amount * (1 - held);
        re[k] *= g;
        im[k] *= g;
        const mk = fftSize - k;
        if (mk < fftSize && mk !== k) {
          re[mk] *= g;
          im[mk] *= g;
        }
      }
      firstFrame = false;

      fft(re, im, true);
      for (let i = 0; i < fftSize; i++) {
        const p = start + i;
        acc[p] += re[i] * w[i];
        norm[p] += w[i] * w[i];
      }
    }

    const dst = out.channels[c];
    for (let i = 0; i < n; i++) {
      const p = i + pad;
      dst[i] = norm[p] > 1e-8 ? acc[p] / norm[p] : 0;
    }
  }

  return out;
}
