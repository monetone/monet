// ─────────────────────────────────────────────────────────────
// engine/dsp/dereverb — Adobe Audition–style DeReverb (tail suppression)
// ─────────────────────────────────────────────────────────────
// Reverberation is the diffuse, decaying tail that follows direct sound. Unlike
// the noise tools (which estimate a stationary FLOOR — the quiet background — via
// a minimum/percentile follower and gate everything at/below it), DeReverb tracks
// the opposite quantity: a per-bin DECAYING PEAK-HOLD of the magnitude that
// follows each onset down as it rings out. The suppression gain is computed
// CAUSALLY from the PRIOR estimate, so a fresh onset (mag ≫ revEst) passes intact
// while a frame whose energy merely sustains the decaying peak (mag ≲ revEst) — the
// reverb tail — is attenuated. A WOLA STFT (Hann, 75% overlap, front/back padded)
// applies the per-bin gain and overlap-adds. Pure `(AudioData, opts) => AudioData`;
// the input is never mutated.

import { cloneAudioData, createAudioData } from "../audio/buffer";
import { clamp, dbToGain } from "../audio/db";
import { channelCount, frameCount, type AudioData } from "../audio/types";
import { fft, isPow2 } from "../analysis/fft";
import { windowValue } from "../analysis/spectrum";
import { DEFAULT_NR_FFT_SIZE } from "./noise-reduction";

export interface DeReverbOptions {
  /** STFT size (power of two). Default 4096. */
  fftSize?: number;
  /** How much of the estimated reverb tail to remove, 0…1. Default 0.8. */
  amount?: number;
  /**
   * Reverberation time the estimator tracks (peak-hold decay), ms — larger holds
   * longer tails. Default 500. Values much shorter than one analysis hop
   * (≈ fftSize/sampleRate seconds, ~93 ms at the 4096 default) leave the
   * estimator near-memoryless and have little to no effect.
   */
  reverbMs?: number;
  /** Maximum attenuation applied to a fully-reverberant bin, dB. Default 20. */
  reduceByDb?: number;
  /** Temporal release of the gain mask, 0…<1 (opens instantly, closes slowly — tames musical noise); values ≥ 1 are clamped to 0.999. Default 0.5. */
  spectralDecay?: number;
}

/** Hann window of length n. */
function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = windowValue("hann", i, n);
  return w;
}

/**
 * Suppress reverberation by attenuating the decaying spectral tail that follows
 * each onset. Frame count is preserved and the input is not mutated.
 *
 * @remarks Single-channel magnitude processing cannot separate a genuinely
 * sustained tone from "onset + reverb of the same pitch", so long sustained
 * content is also attenuated somewhat — this is inherent to the method and scales
 * with `amount`. Intended for speech/percussive material with clear onsets.
 */
export function deReverb(d: AudioData, opts: DeReverbOptions = {}): AudioData {
  const fftSize = opts.fftSize ?? DEFAULT_NR_FFT_SIZE;
  if (!isPow2(fftSize)) throw new Error(`deReverb: fftSize ${fftSize} must be a power of two`);

  const n = frameCount(d);
  const ch = channelCount(d);
  if (n === 0 || ch === 0) return cloneAudioData(d);

  const amount = clamp(opts.amount ?? 0.8, 0, 1);
  const reduceByDb = Math.max(0, opts.reduceByDb ?? 20);
  const floorGain = dbToGain(-reduceByDb);
  const decay = clamp(opts.spectralDecay ?? 0.5, 0, 0.999);
  const hop = Math.max(1, fftSize >> 2); // 75% overlap
  const half = fftSize / 2 + 1;
  const sr = d.sampleRate;

  // Reverb peak-hold decay per analysis hop: larger reverbMs ⇒ slower decay ⇒ the
  // estimate stays above (and thus suppresses) longer-ringing tails.
  const hopSec = hop / sr;
  const revCoef = Math.exp(-hopSec / (Math.max(1, opts.reverbMs ?? 500) / 1000));

  const w = hann(fftSize);
  const out = createAudioData(ch, n, sr);
  // re/im are FFT scratch — re-zeroed at the start of every hop, so they are safe
  // to allocate once and reuse across channels.
  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);
  const revEst = new Float64Array(half); // per-bin decaying peak-hold = reverb-tail estimate
  const prevGain = new Float64Array(half);

  const pad = fftSize;
  const plen = n + pad * 2;

  for (let c = 0; c < ch; c++) {
    const src = d.channels[c];
    const acc = new Float64Array(plen);
    const norm = new Float64Array(plen);
    revEst.fill(0);
    prevGain.fill(0);

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
        // The reverb estimate for THIS frame is the prior peak decayed one hop —
        // it deliberately excludes the current magnitude so a fresh transient is
        // never suppressed by its own energy.
        const revPrior = revCoef * revEst[k];
        let rawGain = mag > 1e-12 ? clamp((mag - revPrior) / mag, 0, 1) : 1;
        rawGain = Math.max(floorGain, rawGain);

        // Temporal release: open instantly to let onsets through, close slowly.
        const held = rawGain >= prevGain[k] ? rawGain : prevGain[k] * decay + rawGain * (1 - decay);
        prevGain[k] = held;

        const g = 1 - amount * (1 - held);
        re[k] *= g;
        im[k] *= g;
        const mk = fftSize - k;
        if (mk < fftSize && mk !== k) {
          re[mk] *= g;
          im[mk] *= g;
        }

        // Peak-hold update AFTER the gain: track the louder of the decayed peak
        // and the current magnitude so the estimate rings down with the tail.
        revEst[k] = Math.max(revPrior, mag);
      }

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
