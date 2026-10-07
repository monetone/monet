// ─────────────────────────────────────────────────────────────
// engine/dsp/fft-filter — Adobe Audition–style FFT Filter
// ─────────────────────────────────────────────────────────────
// Applies an arbitrary frequency-response curve straight in the FFT domain —
// the "draw a curve on the graph" filter. Unlike the biquad parametric/graphic
// EQ, the response is whatever the control points describe, so it can be a
// brick-wall low/high-pass, a narrow telephone band-pass, or a precise notch.
//
// The curve is a list of {freq, gainDb} points; it is sampled per FFT bin
// (linear interpolation, clamped past the ends) into a gain table, then applied
// by a short-time Fourier transform: each frame is windowed + FFT'd, every bin's
// real/imaginary parts are scaled by that bin's gain (phase preserved), and the
// inverse frames are stitched back with weighted overlap-add. Front/back padding
// + window² normalization make a flat (0 dB) curve an exact reconstruction.
// Pure `(AudioData, opts) => AudioData`; the input is never mutated.

import { cloneAudioData, createAudioData } from "../audio/buffer";
import { dbToGain } from "../audio/db";
import { channelCount, frameCount, type AudioData } from "../audio/types";
import { fft, isPow2 } from "../analysis/fft";
import { windowValue } from "../analysis/spectrum";

/** One control point of the response curve. */
export interface FFTFilterPoint {
  freq: number;
  gainDb: number;
}

export interface FFTFilterOptions {
  /** Response curve as {freq, gainDb} control points (any order). */
  curve: FFTFilterPoint[];
  /** FFT size (power of two), default 2048. */
  fftSize?: number;
}

const DEFAULT_FFT = 2048;

function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = windowValue("hann", i, n);
  return w;
}

/** Interpolate the curve's gain (dB) at `freq`, clamped to the end points. */
function gainDbAt(curve: FFTFilterPoint[], freq: number): number {
  if (curve.length === 0) return 0;
  if (freq <= curve[0].freq) return curve[0].gainDb;
  const last = curve[curve.length - 1];
  if (freq >= last.freq) return last.gainDb;
  for (let i = 0; i < curve.length - 1; i++) {
    const a = curve[i];
    const b = curve[i + 1];
    if (freq >= a.freq && freq <= b.freq) {
      const t = b.freq === a.freq ? 0 : (freq - a.freq) / (b.freq - a.freq);
      return a.gainDb * (1 - t) + b.gainDb * t;
    }
  }
  return last.gainDb;
}

/**
 * Apply an arbitrary frequency-response curve via STFT. Output keeps the input's
 * channel and frame count; the input is not mutated.
 */
export function fftFilter(d: AudioData, opts: FFTFilterOptions): AudioData {
  const fftSize = opts.fftSize ?? DEFAULT_FFT;
  if (!isPow2(fftSize)) throw new Error(`fftFilter: fftSize ${fftSize} must be a power of two`);
  const n = frameCount(d);
  const ch = channelCount(d);
  if (n === 0 || ch === 0) return cloneAudioData(d);

  const half = fftSize / 2 + 1;
  const curve = [...(opts.curve ?? [])].sort((a, b) => a.freq - b.freq);
  const gain = new Float64Array(half);
  for (let k = 0; k < half; k++) gain[k] = dbToGain(gainDbAt(curve, (k * d.sampleRate) / fftSize));

  const w = hann(fftSize);
  const hop = Math.max(1, fftSize >> 2); // 75% overlap
  const pad = fftSize;
  const plen = n + pad * 2;
  const out = createAudioData(ch, n, d.sampleRate);
  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);

  for (let c = 0; c < ch; c++) {
    const src = d.channels[c];
    const acc = new Float64Array(plen);
    const norm = new Float64Array(plen);

    for (let start = 0; start + fftSize <= plen; start += hop) {
      re.fill(0);
      im.fill(0);
      for (let i = 0; i < fftSize; i++) {
        const idx = start + i - pad;
        re[i] = (idx >= 0 && idx < n ? src[idx] : 0) * w[i];
      }
      fft(re, im, false);
      for (let k = 0; k < half; k++) {
        const g = gain[k];
        re[k] *= g;
        im[k] *= g;
        const mk = fftSize - k; // mirror the conjugate bin so the inverse stays real
        if (mk < fftSize && mk !== k) {
          re[mk] *= g;
          im[mk] *= g;
        }
      }
      fft(re, im, true);
      for (let i = 0; i < fftSize; i++) {
        acc[start + i] += re[i] * w[i];
        norm[start + i] += w[i] * w[i];
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
