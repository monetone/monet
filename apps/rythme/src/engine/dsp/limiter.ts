// ─────────────────────────────────────────────────────────────
// engine/dsp/limiter — Adobe Audition–style Hard Limiter (+ True Peak)
// ─────────────────────────────────────────────────────────────
// A look-ahead brickwall maximizer: boost the input, then guarantee the output
// never exceeds a ceiling. Unlike dsp/dynamics' simple limit() (a steep
// compressor), this looks AHEAD — it reduces gain before a peak arrives so the
// ceiling is never overshot, then releases smoothly.
//
// The required per-sample gain is `ceiling / peak` whenever the (stereo-linked)
// peak is over the ceiling. Taking a forward sliding-window minimum of that gain
// over the look-ahead window means the gain at any sample is already low enough
// for every peak in the next L samples, so applying it directly (no latency)
// keeps |out| ≤ ceiling exactly while ducking gain in advance of loud moments.
//
// hardLimiter detects the SAMPLE peak; truePeakLimiter detects the INTER-SAMPLE
// (true) peak via 4× oversampling, so the reconstructed waveform a DAC produces
// stays under the ceiling too (a sample-peak limiter can still clip the converter).

import { cloneAudioData } from "../audio/buffer";
import { dbToGain } from "../audio/db";
import { channelCount, frameCount, type AudioData } from "../audio/types";
import { truePeakEnvelope } from "../analysis/loudness";

/**
 * Forward sliding-window minimum of a per-sample required gain over the
 * look-ahead window (monotonic deque, O(n)) with release smoothing. The gain at
 * any sample is already low enough for every peak in the next `lookAhead`
 * samples, so applying it with no latency keeps the signal under the ceiling
 * while ducking in advance of loud moments; gain returns smoothly via `rCoef`.
 */
function smoothLookaheadMinGain(reqGain: Float64Array, n: number, lookAhead: number, rCoef: number, releaseCoefs?: Float64Array): Float64Array {
  const env = new Float64Array(n);
  const dq = new Int32Array(n);
  let head = 0;
  let tail = 0;
  let pushed = 0;
  let g = 1;
  for (let i = 0; i < n; i++) {
    const limit = Math.min(n - 1, i + lookAhead);
    while (pushed <= limit) {
      const v = reqGain[pushed];
      while (tail > head && reqGain[dq[tail - 1]] >= v) tail--;
      dq[tail++] = pushed;
      pushed++;
    }
    while (dq[head] < i) head++;
    const target = reqGain[dq[head]]; // min over the look-ahead window
    const nextRCoef = releaseCoefs?.[i] ?? rCoef;
    // Instant attack (so the ceiling is never breached), smooth release.
    g = target < g ? target : nextRCoef * g + (1 - nextRCoef) * target;
    env[i] = g;
  }
  return env;
}

function smoothDynamicLookaheadMinGain(
  reqGain: Float64Array,
  n: number,
  lookAheadSamples: Int32Array,
  rCoef: number,
  releaseCoefs?: Float64Array,
): Float64Array {
  const env = new Float64Array(n);
  const { tree, size } = buildRangeMinTree(reqGain, n);
  let g = 1;
  for (let i = 0; i < n; i++) {
    const target = rangeMin(tree, size, i, Math.min(n - 1, i + lookAheadSamples[i]));
    const nextRCoef = releaseCoefs?.[i] ?? rCoef;
    g = target < g ? target : nextRCoef * g + (1 - nextRCoef) * target;
    env[i] = g;
  }
  return env;
}

function buildRangeMinTree(values: Float64Array, n: number): { tree: Float64Array; size: number } {
  let size = 1;
  while (size < n) size *= 2;
  const tree = new Float64Array(size * 2);
  tree.fill(1);
  tree.set(values, size);
  for (let i = size - 1; i > 0; i--) tree[i] = Math.min(tree[i * 2], tree[i * 2 + 1]);
  return { tree, size };
}

function rangeMin(tree: Float64Array, size: number, left: number, right: number): number {
  let l = left + size;
  let r = right + size;
  let min = 1;
  while (l <= r) {
    if (l % 2 === 1) min = Math.min(min, tree[l++]);
    if (r % 2 === 0) min = Math.min(min, tree[r--]);
    l = Math.floor(l / 2);
    r = Math.floor(r / 2);
  }
  return min;
}

function lookAheadSamplesFromMs(ms: number, sampleRate: number): number {
  const safeMs = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  return Math.max(0, Math.round((safeMs / 1000) * sampleRate));
}

/** Boost into a fresh buffer, apply a per-sample gain envelope, return it. */
function limitWith(
  d: AudioData,
  boost: number | Float64Array,
  reqGain: Float64Array,
  lookAhead: number,
  rCoef: number,
  releaseCoefs?: Float64Array,
  lookAheadSamples?: Int32Array,
): AudioData {
  const n = frameCount(d);
  const out = cloneAudioData(d);
  const env = lookAheadSamples
    ? smoothDynamicLookaheadMinGain(reqGain, n, lookAheadSamples, rCoef, releaseCoefs)
    : smoothLookaheadMinGain(reqGain, n, lookAhead, rCoef, releaseCoefs);
  if (boost instanceof Float64Array) {
    for (let c = 0; c < out.channels.length; c++) {
      const src = d.channels[c];
      const dst = out.channels[c];
      for (let i = 0; i < n; i++) dst[i] = src[i] * boost[i] * env[i];
    }
  } else {
    if (boost !== 1) for (const c of out.channels) for (let i = 0; i < n; i++) c[i] *= boost;
    for (const c of out.channels) for (let i = 0; i < n; i++) c[i] *= env[i];
  }
  return out;
}

export interface HardLimiterOptions {
  /** Output ceiling — the maximum output amplitude, in dBFS (Audition "Maximum Amplitude"). */
  ceilingDb?: number;
  /** Gain applied to the signal before limiting, in dB (Audition "Input Boost"). */
  inputBoostDb?: number;
  /** How far ahead to anticipate peaks, in ms (Audition "Look-Ahead Time"). */
  lookAheadMs?: number;
  /** How quickly gain returns to unity after a peak, in ms (Audition "Release Time"). */
  releaseMs?: number;
  automation?: HardLimiterAutomationOptions;
}

type HardLimiterParamResolver = (timeSeconds: number, fallback: number) => number;

export interface HardLimiterAutomationOptions {
  offsetSeconds?: number;
  ceilingDb?: HardLimiterParamResolver;
  inputBoostDb?: HardLimiterParamResolver;
  lookAheadMs?: HardLimiterParamResolver;
  releaseMs?: HardLimiterParamResolver;
}

/**
 * Look-ahead hard limiter / maximizer. Output sample peak never exceeds the
 * ceiling. The result keeps the input's channel + frame count; input unmutated.
 */
export function hardLimiter(d: AudioData, opts: HardLimiterOptions = {}): AudioData {
  const ch = channelCount(d);
  const n = frameCount(d);
  if (ch === 0 || n === 0) return cloneAudioData(d);

  const ceilingDb = opts.ceilingDb ?? -0.1;
  const inputBoostDb = opts.inputBoostDb ?? 0;
  const lookAheadMs = opts.lookAheadMs ?? 5;
  const releaseMs = opts.releaseMs ?? 100;
  const ceiling = dbToGain(ceilingDb);
  const boost = dbToGain(inputBoostDb);
  const lookAhead = lookAheadSamplesFromMs(lookAheadMs, d.sampleRate);
  const rCoef = Math.exp(-1 / ((Math.max(1, releaseMs) / 1000) * d.sampleRate));
  const automation = opts.automation;
  const offset = automation?.offsetSeconds ?? 0;
  const hasTimeVaryingCeiling = !!automation?.ceilingDb;
  const hasTimeVaryingBoost = !!automation?.inputBoostDb;
  const hasTimeVaryingLookAhead = !!automation?.lookAheadMs;
  const hasTimeVaryingRelease = !!automation?.releaseMs;
  const boostGains = hasTimeVaryingBoost ? new Float64Array(n) : undefined;
  const lookAheadSamples = hasTimeVaryingLookAhead ? new Int32Array(n) : undefined;
  const releaseCoefs = hasTimeVaryingRelease ? new Float64Array(n) : undefined;

  // Required gain per sample to hold the (stereo-linked) sample peak at the ceiling.
  const reqGain = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const time = offset + i / d.sampleRate;
    const nextCeiling = hasTimeVaryingCeiling ? dbToGain(automation?.ceilingDb?.(time, ceilingDb) ?? ceilingDb) : ceiling;
    const nextBoost = hasTimeVaryingBoost ? dbToGain(automation?.inputBoostDb?.(time, inputBoostDb) ?? inputBoostDb) : boost;
    if (boostGains) boostGains[i] = nextBoost;
    if (lookAheadSamples) lookAheadSamples[i] = lookAheadSamplesFromMs(automation?.lookAheadMs?.(time, lookAheadMs) ?? lookAheadMs, d.sampleRate);
    if (releaseCoefs) {
      const nextReleaseMs = Math.max(1, automation?.releaseMs?.(time, releaseMs) ?? releaseMs);
      releaseCoefs[i] = Math.exp(-1 / ((nextReleaseMs / 1000) * d.sampleRate));
    }
    let peak = 0;
    for (let c = 0; c < ch; c++) {
      const a = Math.abs(d.channels[c][i] * nextBoost);
      if (a > peak) peak = a;
    }
    reqGain[i] = peak > nextCeiling ? nextCeiling / peak : 1;
  }

  return limitWith(d, boostGains ?? boost, reqGain, lookAhead, rCoef, releaseCoefs, lookAheadSamples);
}

export interface TruePeakLimiterOptions {
  /** Output ceiling for the inter-sample (true) peak, in dBTP (default −1). */
  ceilingDb?: number;
  /** Gain applied to the signal before limiting, in dB. */
  inputBoostDb?: number;
  /** How far ahead to anticipate peaks, in ms. */
  lookAheadMs?: number;
  /** How quickly gain returns to unity after a peak, in ms. */
  releaseMs?: number;
}

/**
 * True Peak (ISP) limiter — Audition's Hard Limiter "True Peak Limiting": holds
 * the 4×-oversampled inter-sample peak under the ceiling, so the signal a DAC
 * reconstructs never clips. Gain is driven by the true-peak envelope of the
 * boosted signal (which already accounts for the overshoot between samples) and
 * smoothed with the same look-ahead minimum as the hard limiter.
 */
export function truePeakLimiter(d: AudioData, opts: TruePeakLimiterOptions = {}): AudioData {
  const ch = channelCount(d);
  const n = frameCount(d);
  if (ch === 0 || n === 0) return cloneAudioData(d);

  const ceiling = dbToGain(opts.ceilingDb ?? -1);
  const boost = dbToGain(opts.inputBoostDb ?? 0);
  const lookAhead = Math.max(1, Math.round(((opts.lookAheadMs ?? 5) / 1000) * d.sampleRate));
  const rCoef = Math.exp(-1 / ((Math.max(1, opts.releaseMs ?? 100) / 1000) * d.sampleRate));

  const boosted = cloneAudioData(d);
  if (boost !== 1) for (const c of boosted.channels) for (let i = 0; i < n; i++) c[i] *= boost;

  // Required gain per sample to hold the stereo-linked TRUE peak at the ceiling.
  const env = truePeakEnvelope(boosted);
  const reqGain = new Float64Array(n);
  for (let i = 0; i < n; i++) reqGain[i] = env[i] > ceiling ? ceiling / env[i] : 1;

  return limitWith(d, boost, reqGain, lookAhead, rCoef);
}
