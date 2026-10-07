// ─────────────────────────────────────────────────────────────
// engine/analysis/loudness — ITU-R BS.1770 / EBU R128 LUFS + True Peak
// ─────────────────────────────────────────────────────────────
// K-weighted loudness: a high-shelf "head" filter + a high-pass, then mean
// square per 400 ms block, then the two-stage gating (absolute -70 LUFS +
// relative -10 LU) that defines INTEGRATED loudness. Channel weights follow
// BS.1770 (L/R = 1.0; the surround boost is unused for mono/stereo).
//
// The same machinery yields the rest of the Adobe Audition "Loudness" /
// "Match Loudness" meter: momentary (400 ms) and short-term (3 s) maxima, the
// EBU Tech 3342 Loudness Range (LRA, the gated 10th–95th percentile spread of
// the short-term loudness), and the True Peak (dBTP) — the inter-sample peak
// recovered by 4× oversampling per BS.1770-4 Annex 2.

import { designBiquad, processBiquadChannel, type BiquadCoeffs } from "../dsp/biquad";
import { cloneAudioData } from "../audio/buffer";
import type { AudioData } from "../audio/types";

/** The two K-weighting stages as biquad coefficients for a sample rate. */
function kWeightingFilters(sampleRate: number): [BiquadCoeffs, BiquadCoeffs] {
  // Stage 1: high-shelf (+4 dB @ ~1681 Hz). Stage 2: high-pass (~38 Hz).
  const shelf = designBiquad({ type: "highshelf", freq: 1681.97, q: 0.7071752, gainDb: 3.999 }, sampleRate);
  const hp = designBiquad({ type: "highpass", freq: 38.135, q: 0.5003 }, sampleRate);
  return [shelf, hp];
}

/** Apply K-weighting to a copy of the buffer. */
export function kWeight(d: AudioData): AudioData {
  const [shelf, hp] = kWeightingFilters(d.sampleRate);
  const out = cloneAudioData(d);
  for (const ch of out.channels) {
    processBiquadChannel(ch, shelf);
    processBiquadChannel(ch, hp);
  }
  return out;
}

/** Loudness (LUFS) from a mean-square value. */
function msToLufs(meanSquare: number): number {
  return meanSquare > 0 ? -0.691 + 10 * Math.log10(meanSquare) : -Infinity;
}

/** Inverse of {@link msToLufs}: the mean-square that produces a given LUFS. */
function lufsToMs(lufs: number): number {
  return Math.pow(10, (lufs + 0.691) / 10);
}

/** A loudness measurement over time: the per-window centre times and LUFS. */
export interface LoudnessSeries {
  /** Window centre times, seconds. */
  times: number[];
  /** Loudness at each window, LUFS. */
  lufs: number[];
}

/**
 * Channel-summed K-weighted mean-square loudness of every window of length
 * `winSec` stepped by `stepSec` over an already-weighted buffer, as a time
 * series. Used for both the momentary (0.4 s) and short-term (3 s) ladders.
 */
function windowSeries(weighted: AudioData, winSec: number, stepSec: number): LoudnessSeries {
  const sr = weighted.sampleRate;
  const len = Math.round(winSec * sr);
  const step = Math.max(1, Math.round(stepSec * sr));
  const n = weighted.channels.length ? weighted.channels[0].length : 0;
  const times: number[] = [];
  const lufs: number[] = [];
  if (len <= 0 || n < len) return { times, lufs };
  for (let start = 0; start + len <= n; start += step) {
    let ms = 0;
    for (let c = 0; c < weighted.channels.length; c++) {
      const ch = weighted.channels[c];
      let sum = 0;
      for (let i = 0; i < len; i++) sum += ch[start + i] * ch[start + i];
      ms += sum / len; // channel weight 1.0 for L/R
    }
    times.push((start + len / 2) / sr); // window centre
    lufs.push(msToLufs(ms));
  }
  return { times, lufs };
}

/** Just the per-window LUFS values (the momentary / short-term ladders). */
function windowLoudness(weighted: AudioData, winSec: number, stepSec: number): number[] {
  return windowSeries(weighted, winSec, stepSec).lufs;
}

/**
 * EBU Tech 3342 Loudness Range from a list of short-term (3 s) loudness values:
 * absolute-gate at −70 LUFS, then relative-gate at (gated power-mean − 20 LU),
 * then LRA = P95 − P10 of the surviving short-term loudnesses.
 */
function loudnessRange(shortTerm: number[]): number {
  const absGated = shortTerm.filter((l) => l > -70);
  if (absGated.length < 2) return 0;
  const meanMs = absGated.reduce((a, l) => a + lufsToMs(l), 0) / absGated.length;
  const relThreshold = msToLufs(meanMs) - 20;
  const gated = absGated.filter((l) => l > relThreshold).sort((a, b) => a - b);
  if (gated.length < 2) return 0;
  const percentile = (p: number): number => {
    const idx = (p / 100) * (gated.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return gated[lo] + (gated[hi] - gated[lo]) * (idx - lo);
  };
  return percentile(95) - percentile(10);
}

export interface LoudnessResult {
  /** Integrated (gated) loudness, LUFS. */
  integrated: number;
  /** Maximum momentary (400 ms) loudness, LUFS. */
  momentaryMax: number;
  /** Maximum short-term (3 s) loudness, LUFS. */
  shortTermMax: number;
  /** Loudness Range (EBU Tech 3342, gated P95 − P10 of short-term loudness), LU. */
  range: number;
}

/**
 * Integrated loudness with the BS.1770 two-stage gate (400 ms / 100 ms blocks),
 * plus the short-term (3 s) maximum and the EBU R128 Loudness Range.
 */
export function measureLoudness(d: AudioData): LoudnessResult {
  const weighted = kWeight(d);
  const sr = d.sampleRate;
  const blockLen = Math.round(0.4 * sr);
  const step = Math.round(0.1 * sr);
  const chN = weighted.channels.length;
  const empty: LoudnessResult = { integrated: -Infinity, momentaryMax: -Infinity, shortTermMax: -Infinity, range: 0 };
  if (blockLen <= 0 || !chN || weighted.channels[0].length < blockLen) return empty;

  const blocks: number[] = []; // mean-square per gating block (channel-summed)
  let momentaryMax = -Infinity;
  for (let start = 0; start + blockLen <= weighted.channels[0].length; start += step) {
    let ms = 0;
    for (let c = 0; c < chN; c++) {
      const ch = weighted.channels[c];
      let sum = 0;
      for (let i = 0; i < blockLen; i++) sum += ch[start + i] * ch[start + i];
      ms += sum / blockLen; // channel weight 1.0 for L/R
    }
    blocks.push(ms);
    momentaryMax = Math.max(momentaryMax, msToLufs(ms));
  }
  if (blocks.length === 0) return empty;

  // Short-term ladder (3 s window, 1 s step) → max + Loudness Range.
  const shortTerm = windowLoudness(weighted, 3, 1);
  const shortTermMax = shortTerm.length ? Math.max(...shortTerm) : -Infinity;
  const range = loudnessRange(shortTerm);

  // Absolute gate at -70 LUFS
  const absGated = blocks.filter((ms) => msToLufs(ms) > -70);
  if (absGated.length === 0) return { integrated: -Infinity, momentaryMax, shortTermMax, range };
  const absMean = absGated.reduce((a, b) => a + b, 0) / absGated.length;
  const relThreshold = msToLufs(absMean) - 10;

  // Relative gate
  const relGated = absGated.filter((ms) => msToLufs(ms) > relThreshold);
  const finalSet = relGated.length ? relGated : absGated;
  const mean = finalSet.reduce((a, b) => a + b, 0) / finalSet.length;
  const integrated = msToLufs(mean);
  return { integrated, momentaryMax, shortTermMax, range };
}

export interface LoudnessTimeSeries {
  /** Momentary (400 ms window, 100 ms step) loudness over time. */
  momentary: LoudnessSeries;
  /** Short-term (3 s window, 1 s step) loudness over time. */
  shortTerm: LoudnessSeries;
  /** Gated integrated loudness, LUFS. */
  integrated: number;
  /** Loudness Range (EBU R128 LRA), LU. */
  range: number;
}

/**
 * Loudness over time — the data behind Audition's Loudness Radar: the momentary
 * and short-term loudness ladders as time series, plus the integrated value and
 * range. The input is not mutated.
 */
export function loudnessTimeSeries(d: AudioData): LoudnessTimeSeries {
  const weighted = kWeight(d);
  const summary = measureLoudness(d);
  return {
    momentary: windowSeries(weighted, 0.4, 0.1),
    shortTerm: windowSeries(weighted, 3, 1),
    integrated: summary.integrated,
    range: summary.range,
  };
}

// ── True Peak (dBTP) ────────────────────────────────────────────────────────
// BS.1770-4 Annex 2: a sample-peak meter misses the overshoot a DAC reconstructs
// *between* samples, so the signal is oversampled (≥4×) with a band-limited
// interpolation filter and the peak is taken of the reconstructed waveform.
// We use a 4-phase Blackman-windowed-sinc interpolator (24 taps/phase). Phase 0
// reproduces the original samples exactly (so True Peak is never below the
// sample peak); the three fractional phases recover the inter-sample peaks.

const TP_OVERSAMPLE = 4;
const TP_HALF_TAPS = 12; // taps each side of the interpolation point

function sinc(t: number): number {
  if (t === 0) return 1;
  const x = Math.PI * t;
  return Math.sin(x) / x;
}

/** Blackman window of the normalised argument u ∈ [-1, 1]; 0 outside. */
function blackman(u: number): number {
  if (u < -1 || u > 1) return 0;
  return 0.42 + 0.5 * Math.cos(Math.PI * u) + 0.08 * Math.cos(2 * Math.PI * u);
}

/** Per-phase interpolation kernels, normalised to unit DC gain. */
function truePeakKernels(): number[][] {
  const kernels: number[][] = [];
  for (let p = 0; p < TP_OVERSAMPLE; p++) {
    const d = p / TP_OVERSAMPLE; // fractional offset into [0, 1)
    const taps: number[] = [];
    let sum = 0;
    for (let k = -(TP_HALF_TAPS - 1); k <= TP_HALF_TAPS; k++) {
      const t = k - d;
      const v = sinc(t) * blackman(t / TP_HALF_TAPS);
      taps.push(v);
      sum += v;
    }
    for (let i = 0; i < taps.length; i++) taps[i] /= sum || 1;
    kernels.push(taps);
  }
  return kernels;
}

const TP_KERNELS = truePeakKernels();

export interface TruePeakResult {
  /** Maximum true peak across all channels, dBTP (0 dBTP = full scale). */
  dBTP: number;
  /** Per-channel true peak, dBTP. */
  channels: number[];
}

/** The reconstructed signal value at fraction `phase`/4 past sample `i`. */
function interpAt(x: Float32Array, i: number, phase: number, n: number): number {
  if (phase === 0) return x[i]; // phase 0 = the sample itself
  const ker = TP_KERNELS[phase];
  let acc = 0;
  let ki = 0;
  for (let k = -(TP_HALF_TAPS - 1); k <= TP_HALF_TAPS; k++, ki++) {
    const idx = i + k;
    if (idx >= 0 && idx < n) acc += x[idx] * ker[ki];
  }
  return acc;
}

/** Largest absolute true (inter-sample) peak of one channel, linear. */
function channelTruePeak(ch: Float32Array): number {
  const n = ch.length;
  let peak = 0;
  for (let i = 0; i < n; i++) {
    for (let p = 0; p < TP_OVERSAMPLE; p++) {
      const a = Math.abs(interpAt(ch, i, p, n));
      if (a > peak) peak = a;
    }
  }
  return peak;
}

/**
 * True Peak (dBTP) per ITU-R BS.1770-4 Annex 2 — the peak of the 4×-oversampled,
 * band-limited reconstruction. A signal whose samples straddle a peak (e.g. a
 * tone near fs/4) reads higher here than its sample peak; a low-frequency or DC
 * signal reads essentially the same.
 */
export function measureTruePeak(d: AudioData): TruePeakResult {
  const channels = d.channels.map((ch) => {
    const peak = channelTruePeak(ch);
    return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
  });
  const dBTP = channels.length ? Math.max(...channels) : -Infinity;
  return { dBTP, channels };
}

/**
 * Per-frame true-peak envelope (stereo-linked): for each frame `i`, the largest
 * absolute inter-sample value over the four oversample phases covering [i, i+1)
 * across all channels. This is what a True Peak limiter detects to hold the
 * reconstructed peak — not just the sample peak — under a ceiling.
 */
export function truePeakEnvelope(d: AudioData): Float64Array {
  const chs = d.channels;
  const n = chs.length ? chs[0].length : 0;
  const env = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let peak = 0;
    for (let c = 0; c < chs.length; c++) {
      for (let p = 0; p < TP_OVERSAMPLE; p++) {
        const a = Math.abs(interpAt(chs[c], i, p, n));
        if (a > peak) peak = a;
      }
    }
    env[i] = peak;
  }
  return env;
}
