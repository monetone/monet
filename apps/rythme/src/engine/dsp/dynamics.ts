// ─────────────────────────────────────────────────────────────
// engine/dsp/dynamics — compressor, limiter, gate/expander
// ─────────────────────────────────────────────────────────────
// A shared peak envelope-follower drives all three. The detector is stereo
// LINKED (it tracks the max across channels) so dynamics processing never
// shifts the stereo image. Gain is computed in dB against a soft-knee static
// curve, then smoothed with attack/release and applied equally to all channels.

import { cloneAudioData } from "../audio/buffer";
import { clampSample, dbToGain, gainToDb } from "../audio/db";
import { channelCount, frameCount, type AudioData } from "../audio/types";

export interface CompressorOptions {
  thresholdDb?: number;
  ratio?: number;
  attackMs?: number;
  releaseMs?: number;
  kneeDb?: number;
  makeupDb?: number;
  automation?: CompressorAutomationOptions;
}

export type CompressorParamResolver = (timeSeconds: number, fallback: number) => number;

export interface CompressorAutomationOptions {
  offsetSeconds?: number;
  thresholdDb?: CompressorParamResolver;
  ratio?: CompressorParamResolver;
  attackMs?: CompressorParamResolver;
  releaseMs?: CompressorParamResolver;
  kneeDb?: CompressorParamResolver;
  makeupDb?: CompressorParamResolver;
}

/** Time-constant → one-pole smoothing coefficient. */
function coef(ms: number, sampleRate: number): number {
  const t = Math.max(ms, 0.01) / 1000;
  return Math.exp(-1 / (t * sampleRate));
}

/** Soft-knee static compression curve: input level dB → output level dB. */
function compressCurve(levelDb: number, threshold: number, ratio: number, knee: number): number {
  const over = levelDb - threshold;
  if (knee > 0 && over > -knee / 2 && over < knee / 2) {
    const x = over + knee / 2;
    return levelDb + (1 / ratio - 1) * (x * x) / (2 * knee);
  }
  return over <= 0 ? levelDb : threshold + over / ratio;
}

/**
 * Downward compressor. Detector is peak with attack/release ballistics; gain
 * reduction is applied sample-accurately. `makeupDb` is added after.
 */
export function compress(d: AudioData, opts: CompressorOptions = {}): AudioData {
  const threshold = opts.thresholdDb ?? -18;
  const ratio = opts.ratio ?? 4;
  const attackMs = opts.attackMs ?? 10;
  const releaseMs = opts.releaseMs ?? 120;
  const knee = opts.kneeDb ?? 6;
  const makeupDb = opts.makeupDb ?? 0;
  const sr = d.sampleRate;
  const aCoef = coef(attackMs, sr);
  const rCoef = coef(releaseMs, sr);
  const out = cloneAudioData(d);
  const ch = channelCount(out);
  const n = frameCount(out);
  let env = 0;
  const makeup = dbToGain(makeupDb);
  const automation = opts.automation;
  const offset = automation?.offsetSeconds ?? 0;
  const hasTimeVaryingBallistics = !!(automation?.attackMs || automation?.releaseMs);
  const hasTimeVaryingCurve = !!(automation?.thresholdDb || automation?.ratio || automation?.kneeDb || automation?.makeupDb);
  for (let i = 0; i < n; i++) {
    const time = offset + i / sr;
    const nextAttackMs = hasTimeVaryingBallistics ? Math.max(0.01, automation?.attackMs?.(time, attackMs) ?? attackMs) : attackMs;
    const nextReleaseMs = hasTimeVaryingBallistics ? Math.max(0.01, automation?.releaseMs?.(time, releaseMs) ?? releaseMs) : releaseMs;
    const nextThreshold = hasTimeVaryingCurve ? (automation?.thresholdDb?.(time, threshold) ?? threshold) : threshold;
    const nextRatio = Math.max(1, hasTimeVaryingCurve ? (automation?.ratio?.(time, ratio) ?? ratio) : ratio);
    const nextKnee = Math.max(0, hasTimeVaryingCurve ? (automation?.kneeDb?.(time, knee) ?? knee) : knee);
    const nextMakeup = hasTimeVaryingCurve ? dbToGain(automation?.makeupDb?.(time, makeupDb) ?? makeupDb) : makeup;
    let detect = 0;
    for (let c = 0; c < ch; c++) {
      const a = Math.abs(out.channels[c][i]);
      if (a > detect) detect = a;
    }
    const nextACoef = hasTimeVaryingBallistics ? coef(nextAttackMs, sr) : aCoef;
    const nextRCoef = hasTimeVaryingBallistics ? coef(nextReleaseMs, sr) : rCoef;
    env = detect > env ? nextACoef * env + (1 - nextACoef) * detect : nextRCoef * env + (1 - nextRCoef) * detect;
    const levelDb = gainToDb(env);
    const targetDb = compressCurve(levelDb, nextThreshold, nextRatio, nextKnee);
    const gainLin = dbToGain(targetDb - levelDb) * nextMakeup;
    for (let c = 0; c < ch; c++) out.channels[c][i] = clampSample(out.channels[c][i] * gainLin);
  }
  return out;
}

export interface LimiterOptions {
  thresholdDb?: number;
  releaseMs?: number;
  makeupDb?: number;
}

/** Brickwall-ish limiter: a fast, high-ratio compressor. */
export function limit(d: AudioData, opts: LimiterOptions = {}): AudioData {
  return compress(d, {
    thresholdDb: opts.thresholdDb ?? -1,
    ratio: 20,
    attackMs: 1,
    releaseMs: opts.releaseMs ?? 60,
    kneeDb: 0,
    makeupDb: opts.makeupDb ?? 0,
  });
}

export interface GateOptions {
  thresholdDb?: number;
  ratio?: number;
  attackMs?: number;
  releaseMs?: number;
  /** Maximum attenuation when fully closed, in dB (negative). */
  rangeDb?: number;
}

/**
 * Downward expander / noise gate. Signal below the threshold is attenuated by
 * `(ratio-1)×` the amount it is under, down to `rangeDb`. High ratios behave
 * like a hard gate.
 */
export function gate(d: AudioData, opts: GateOptions = {}): AudioData {
  const threshold = opts.thresholdDb ?? -45;
  const ratio = Math.max(1, opts.ratio ?? 4);
  const range = opts.rangeDb ?? -80;
  const sr = d.sampleRate;
  const aCoef = coef(opts.attackMs ?? 1, sr);
  const rCoef = coef(opts.releaseMs ?? 100, sr);
  const out = cloneAudioData(d);
  const ch = channelCount(out);
  const n = frameCount(out);
  let env = 0;
  for (let i = 0; i < n; i++) {
    let detect = 0;
    for (let c = 0; c < ch; c++) {
      const a = Math.abs(out.channels[c][i]);
      if (a > detect) detect = a;
    }
    env = detect > env ? aCoef * env + (1 - aCoef) * detect : rCoef * env + (1 - rCoef) * detect;
    const levelDb = gainToDb(env);
    let reductionDb = 0;
    if (levelDb < threshold) {
      reductionDb = Math.max(range, (levelDb - threshold) * (ratio - 1));
    }
    const gainLin = dbToGain(reductionDb);
    for (let c = 0; c < ch; c++) out.channels[c][i] *= gainLin;
  }
  return out;
}
