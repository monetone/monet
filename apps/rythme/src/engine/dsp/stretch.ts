// ─────────────────────────────────────────────────────────────
// engine/dsp/stretch — Adobe Audition–style Stretch and Pitch
// ─────────────────────────────────────────────────────────────
// Time and pitch, DECOUPLED — unlike dsp/speed's changeSpeed (which resamples,
// coupling the two). A short-time Fourier transform phase vocoder stretches the
// audio in time while preserving pitch; pitch shifting is then time-stretch
// followed by a resample back to the original length.
//
// The vocoder, per analysis frame: take the windowed FFT, measure each bin's
// true frequency from the phase advance since the previous frame, re-accumulate
// the phase at the (scaled) synthesis hop, and overlap-add the inverse frames
// with the usual window² normalisation. Reuses analysis/fft and the Hann window.
// Pure `(AudioData, …) => AudioData`; the input is never mutated.

import { createAudioData } from "../audio/buffer";
import { channelCount, frameCount, type AudioData } from "../audio/types";
import { fft } from "../analysis/fft";
import { windowValue } from "../analysis/spectrum";

const TWO_PI = 2 * Math.PI;
const FFT_SIZE = 2048;
// 8× overlap keeps the synthesis hop Hs = Ha·factor below the window even at the
// UI's extremes (factor/ratio up to 4 → Hs ≤ N/2), so the overlap never
// collapses and the Hann frames always sum smoothly.
const OVERLAP = 8;

/** Wrap a phase to (−π, π]. */
function princarg(phase: number): number {
  return phase - TWO_PI * Math.round(phase / TWO_PI);
}

function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = windowValue("hann", i, n);
  return w;
}

/** Linear-resample a channel to exactly `targetLen` samples (pitch changes). */
function resampleToLength(src: Float32Array, targetLen: number): Float32Array {
  const out = new Float32Array(targetLen);
  if (src.length === 0 || targetLen === 0) return out;
  if (targetLen === src.length) {
    out.set(src);
    return out;
  }
  const ratio = src.length / targetLen;
  for (let i = 0; i < targetLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(src.length - 1, i0 + 1);
    out[i] = src[i0] * (1 - (pos - i0)) + src[i1] * (pos - i0);
  }
  return out;
}

/** Phase-vocoder time-stretch of a single channel by `factor` (length × factor). */
function stretchChannel(input: Float32Array, factor: number): Float32Array {
  const n = input.length;
  const targetLen = Math.max(0, Math.round(n * factor));
  const N = FFT_SIZE;
  // Too short for a full frame → fall back to a plain resample (pitch shifts
  // here, but the distinction is inaudible at these tiny lengths).
  if (n < N) return resampleToLength(input, targetLen);

  const Ha = Math.max(1, Math.floor(N / OVERLAP));
  const Hs = Math.max(1, Math.round(Ha * factor));
  const half = N / 2 + 1;
  const w = hann(N);
  const omega = new Float64Array(half);
  for (let k = 0; k < half; k++) omega[k] = (TWO_PI * k) / N;

  // Pad the front by a full window so every real output sample is covered by a
  // full set of overlapping frames — without this the leading/trailing samples
  // have partial coverage and dividing by the small window weight blows up the
  // amplitude. Frames run until the window has fully passed the real tail, so
  // the stretched output never ends in silence either.
  const pad = N;
  const outOffset = Math.round(pad * factor);
  const numFrames = Math.floor((pad + n) / Ha) + 1;
  const outLen = Math.max(outOffset + targetLen, (numFrames - 1) * Hs + N) + N;
  const acc = new Float64Array(outLen);
  const norm = new Float64Array(outLen);

  const prevPhase = new Float64Array(half);
  const sumPhase = new Float64Array(half);
  const re = new Float64Array(N);
  const im = new Float64Array(N);

  for (let f = 0; f < numFrames; f++) {
    const inStart = f * Ha;
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < N; i++) {
      const ri = inStart + i - pad; // real input index (front pad reads as zero)
      re[i] = (ri >= 0 && ri < n ? input[ri] : 0) * w[i];
    }
    fft(re, im, false);

    for (let k = 0; k < half; k++) {
      const mag = Math.hypot(re[k], im[k]);
      const phase = Math.atan2(im[k], re[k]);
      const deltaPhase = princarg(phase - prevPhase[k] - omega[k] * Ha);
      const trueFreq = omega[k] + deltaPhase / Ha; // rad / sample
      prevPhase[k] = phase;
      sumPhase[k] = princarg(sumPhase[k] + trueFreq * Hs);
      re[k] = mag * Math.cos(sumPhase[k]);
      im[k] = mag * Math.sin(sumPhase[k]);
      const mk = N - k; // conjugate mirror keeps the inverse real
      if (mk < N && mk !== k) {
        re[mk] = re[k];
        im[mk] = -im[k];
      }
    }
    im[0] = 0; // DC and Nyquist are real
    im[N / 2] = 0;

    fft(re, im, true);
    const outStart = f * Hs;
    for (let i = 0; i < N; i++) {
      acc[outStart + i] += re[i] * w[i];
      norm[outStart + i] += w[i] * w[i];
    }
  }

  const out = new Float32Array(targetLen);
  for (let i = 0; i < targetLen; i++) {
    const p = outOffset + i;
    out[i] = norm[p] > 1e-8 ? acc[p] / norm[p] : 0;
  }
  return out;
}

/**
 * Time-stretch by `factor` (2 = twice as long / half speed, 0.5 = half length /
 * double speed) while preserving pitch. Sample rate and channel count are kept.
 */
export function timeStretch(d: AudioData, factor: number): AudioData {
  if (!(factor > 0)) throw new Error("timeStretch: factor must be > 0");
  if (factor === 1) return { sampleRate: d.sampleRate, channels: d.channels.map((c) => c.slice()) };
  const out = createAudioData(channelCount(d), Math.max(0, Math.round(frameCount(d) * factor)), d.sampleRate);
  for (let c = 0; c < channelCount(d); c++) out.channels[c] = stretchChannel(d.channels[c], factor);
  return out;
}

/**
 * Shift pitch by `semitones` while preserving duration: stretch by the pitch
 * ratio, then resample back to the original length. Positive = higher.
 */
export function pitchShift(d: AudioData, semitones: number): AudioData {
  if (semitones === 0) return { sampleRate: d.sampleRate, channels: d.channels.map((c) => c.slice()) };
  const ratio = Math.pow(2, semitones / 12);
  const n = frameCount(d);
  const out = createAudioData(channelCount(d), n, d.sampleRate);
  for (let c = 0; c < channelCount(d); c++) {
    const stretched = stretchChannel(d.channels[c], ratio);
    out.channels[c] = resampleToLength(stretched, n);
  }
  return out;
}
