// ─────────────────────────────────────────────────────────────
// engine/dsp/de-esser — Adobe Audition–style sibilance reduction
// ─────────────────────────────────────────────────────────────
// A de-esser is a compressor that only acts on sibilance — the harsh "ess" /
// "sh" energy (≈ 5–10 kHz) in speech and vocals. A bandpass tuned to the
// sibilant range drives a peak detector; when that band crosses the threshold
// the gain ducks, following a compressor curve.
//
//   • "split" (default, multiband): only the sibilant band is ducked, so the
//     body of the voice is untouched — out = signal − band·(1 − gain).
//   • "broadband": the whole signal is ducked while sibilance is present —
//     out = signal · gain.
//
// Detection is stereo-linked (the max across channels) so processing never
// shifts the stereo image, matching the engine's other dynamics. Below the
// threshold the gain is unity, so the effect is an exact pass-through. Pure
// `(AudioData, opts) => AudioData`; the input is never mutated.

import { cloneAudioData } from "../audio/buffer";
import { dbToGain, gainToDb } from "../audio/db";
import { channelCount, frameCount, type AudioData } from "../audio/types";
import { applyBiquad } from "./biquad";

export interface DeEsserOptions {
  /** Center of the sibilant band in Hz (Audition "Center Frequency"). */
  centerFreq?: number;
  /** Bandpass quality — higher Q is a narrower sibilance band. */
  q?: number;
  /** Level above which de-essing engages, in dBFS (Audition "Threshold"). */
  thresholdDb?: number;
  /** Compression ratio applied to the over-threshold sibilance. */
  ratio?: number;
  /** Detector attack time, ms. */
  attackMs?: number;
  /** Detector release time, ms. */
  releaseMs?: number;
  /** "split" (multiband, default) or "broadband". */
  mode?: "split" | "broadband";
  /** Optional cap on the maximum gain reduction, in dB. */
  rangeDb?: number;
  /** Output the removed sibilance instead of the de-essed signal. */
  outputSibilanceOnly?: boolean;
  automation?: DeEsserAutomationOptions;
}

type DeEsserParamResolver = (timeSeconds: number, fallback: number) => number;

export interface DeEsserAutomationOptions {
  offsetSeconds?: number;
  thresholdDb?: DeEsserParamResolver;
  ratio?: DeEsserParamResolver;
  attackMs?: DeEsserParamResolver;
  releaseMs?: DeEsserParamResolver;
  rangeDb?: DeEsserParamResolver;
}

/** Time constant (ms) → one-pole smoothing coefficient. */
function coef(ms: number, sampleRate: number): number {
  return Math.exp(-1 / (Math.max(ms, 0.01) / 1000 * sampleRate));
}

/**
 * Reduce sibilance via band-triggered compression. Returns a buffer with the
 * same shape as the input. With `outputSibilanceOnly`, returns only the removed
 * sibilance, so `deEssed + sibilanceOnly === input` sample-for-sample.
 */
export function deEss(d: AudioData, opts: DeEsserOptions = {}): AudioData {
  const ch = channelCount(d);
  const n = frameCount(d);
  if (ch === 0 || n === 0) return cloneAudioData(d);

  const centerFreq = opts.centerFreq ?? 7000;
  const q = Math.max(0.1, opts.q ?? 2.5);
  const thresholdDb = opts.thresholdDb ?? -30;
  const ratio = opts.ratio ?? 4;
  const attackMs = opts.attackMs ?? 1;
  const releaseMs = opts.releaseMs ?? 60;
  const broadband = opts.mode === "broadband";
  // A reduction cap is a positive magnitude; guard against a negative value
  // (which would invert Math.min into a gain boost).
  const rangeDb = opts.rangeDb != null ? Math.max(0, opts.rangeDb) : undefined;
  const sibilanceOnly = !!opts.outputSibilanceOnly;
  const aCoef = coef(attackMs, d.sampleRate);
  const rCoef = coef(releaseMs, d.sampleRate);
  const automation = opts.automation;
  const offset = automation?.offsetSeconds ?? 0;
  const hasTimeVaryingBallistics = !!(automation?.attackMs || automation?.releaseMs);
  const hasTimeVaryingCurve = !!(automation?.thresholdDb || automation?.ratio || automation?.rangeDb);

  // The sibilant band: detector source, and (in split mode) the duck target.
  const band = applyBiquad(d, { type: "bandpass", freq: centerFreq, q });
  const out = cloneAudioData(d);

  let env = 0;
  for (let i = 0; i < n; i++) {
    const time = offset + i / d.sampleRate;
    const nextAttackMs = hasTimeVaryingBallistics ? Math.max(0.01, automation?.attackMs?.(time, attackMs) ?? attackMs) : attackMs;
    const nextReleaseMs = hasTimeVaryingBallistics ? Math.max(0.01, automation?.releaseMs?.(time, releaseMs) ?? releaseMs) : releaseMs;
    const nextThresholdDb = hasTimeVaryingCurve ? (automation?.thresholdDb?.(time, thresholdDb) ?? thresholdDb) : thresholdDb;
    const nextRatio = Math.max(1, hasTimeVaryingCurve ? (automation?.ratio?.(time, ratio) ?? ratio) : ratio);
    const nextRangeDb =
      rangeDb != null || automation?.rangeDb
        ? Math.max(0, automation?.rangeDb?.(time, rangeDb ?? 0) ?? rangeDb ?? 0)
        : undefined;
    const slope = 1 - 1 / nextRatio;
    let detect = 0;
    for (let c = 0; c < ch; c++) {
      const a = Math.abs(band.channels[c][i]);
      if (a > detect) detect = a;
    }
    const nextACoef = hasTimeVaryingBallistics ? coef(nextAttackMs, d.sampleRate) : aCoef;
    const nextRCoef = hasTimeVaryingBallistics ? coef(nextReleaseMs, d.sampleRate) : rCoef;
    const k = detect > env ? nextACoef : nextRCoef;
    env = k * env + (1 - k) * detect;

    const envDb = gainToDb(env);
    let grDb = envDb > nextThresholdDb ? (envDb - nextThresholdDb) * slope : 0;
    if (nextRangeDb != null) grDb = Math.min(grDb, nextRangeDb);
    const gain = dbToGain(-grDb);

    for (let c = 0; c < ch; c++) {
      const source = broadband ? d.channels[c][i] : band.channels[c][i];
      const removed = source * (1 - gain);
      out.channels[c][i] = sibilanceOnly ? removed : d.channels[c][i] - removed;
    }
  }
  return out;
}
