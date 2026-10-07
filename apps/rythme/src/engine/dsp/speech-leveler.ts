// ─────────────────────────────────────────────────────────────
// engine/dsp/speech-leveler — Adobe Audition–style Speech Volume Leveler
// ─────────────────────────────────────────────────────────────
// An automatic, time-varying loudness leveller (AGC) for dialogue: it tracks a
// slow RMS envelope and drives every passage TOWARD a target loudness — boosting
// quiet speech and easing loud parts — so the whole clip sits at a consistent
// level. A silence gate (target dynamic range) keeps it from amplifying the
// background between phrases. Distinct from the Compressor (threshold/ratio range
// reduction that never lifts quiet passages) and from Match Loudness (one static
// global gain): this gain is dynamic and per-passage. The detector is stereo
// LINKED and the gain is applied equally to every channel, so the stereo image
// never shifts. Pure `(AudioData, opts) => AudioData`; the input is not mutated.

import { cloneAudioData } from "../audio/buffer";
import { clamp, clampSample, dbToGain, gainToDb } from "../audio/db";
import { channelCount, frameCount, type AudioData } from "../audio/types";

export interface SpeechLevelerOptions {
  /** Target output level, dBFS. Default -18. */
  targetDb?: number;
  /** Leveling intensity 0…1 (Audition's 0–100). 0 = no change. Default 0.75. */
  amount?: number;
  /** Maximum gain change in either direction, dB. Default 30. */
  maxGainDb?: number;
  /** Silence floor: envelopes below this are left alone (not boosted). Default -50. */
  gateDb?: number;
  /** Envelope / gain time constant, ms. Default 300. */
  windowMs?: number;
  automation?: SpeechLevelerAutomationOptions;
}

type SpeechLevelerParamResolver = (timeSeconds: number, fallback: number) => number;

export interface SpeechLevelerAutomationOptions {
  offsetSeconds?: number;
  targetDb?: SpeechLevelerParamResolver;
  amount?: SpeechLevelerParamResolver;
  maxGainDb?: SpeechLevelerParamResolver;
  gateDb?: SpeechLevelerParamResolver;
  windowMs?: SpeechLevelerParamResolver;
}

/** Soft-knee width (dB) above the gate over which leveling ramps in. */
const GATE_KNEE_DB = 6;

/** Time-constant (ms) → one-pole smoothing coefficient. */
function coef(ms: number, sampleRate: number): number {
  const t = Math.max(ms, 0.01) / 1000;
  return Math.exp(-1 / (t * sampleRate));
}

/**
 * Level a clip toward a target loudness with a slow, per-passage gain. Frame
 * count is preserved and the input is not mutated.
 */
export function speechLeveler(d: AudioData, opts: SpeechLevelerOptions = {}): AudioData {
  const out = cloneAudioData(d);
  const amount = opts.amount ?? 0.75;
  const n = frameCount(d);
  const automation = opts.automation;
  if (n === 0 || (clamp(amount, 0, 1) === 0 && !automation?.amount)) return out;

  const targetDb = opts.targetDb ?? -18;
  const maxGainDb = opts.maxGainDb ?? 30;
  const gateDb = opts.gateDb ?? -50;
  const windowMs = opts.windowMs ?? 300;
  const envCoef = coef(windowMs, d.sampleRate);
  const ch = channelCount(out);
  const offset = automation?.offsetSeconds ?? 0;
  const hasTimeVaryingEnvelope = !!automation?.windowMs;
  const hasTimeVaryingCurve = !!(automation?.targetDb || automation?.amount || automation?.maxGainDb || automation?.gateDb);

  const msCh = new Float64Array(ch); // per-channel smoothed mean-square (RMS²)
  let gainDb = 0; // smoothed applied gain
  for (let i = 0; i < n; i++) {
    const time = offset + i / d.sampleRate;
    const nextAmount = clamp(hasTimeVaryingCurve ? (automation?.amount?.(time, amount) ?? amount) : amount, 0, 1);
    const nextTargetDb = hasTimeVaryingCurve ? (automation?.targetDb?.(time, targetDb) ?? targetDb) : targetDb;
    const nextMaxGainDb = Math.max(0, hasTimeVaryingCurve ? (automation?.maxGainDb?.(time, maxGainDb) ?? maxGainDb) : maxGainDb);
    const nextGateDb = hasTimeVaryingCurve ? (automation?.gateDb?.(time, gateDb) ?? gateDb) : gateDb;
    const nextEnvCoef = hasTimeVaryingEnvelope ? coef(automation?.windowMs?.(time, windowMs) ?? windowMs, d.sampleRate) : envCoef;
    // Stereo-LINKED RMS envelope: smooth each channel's mean-square, then link on
    // the loudest, so dynamics never shift the stereo image.
    let linkedMs = 0;
    for (let c = 0; c < ch; c++) {
      const x = d.channels[c][i];
      msCh[c] = nextEnvCoef * msCh[c] + (1 - nextEnvCoef) * x * x;
      if (msCh[c] > linkedMs) linkedMs = msCh[c];
    }
    const envDb = gainToDb(Math.sqrt(linkedMs));

    // Below the silence floor, leave the level alone; ramp leveling in over a
    // soft knee just above the floor so the gate has no audible step. Otherwise
    // drive toward the target, capped both ways, scaled by the leveling amount.
    let desiredDb = 0;
    if (envDb > nextGateDb) {
      const full = clamp(nextTargetDb - envDb, -nextMaxGainDb, nextMaxGainDb);
      desiredDb = Math.min(1, (envDb - nextGateDb) / GATE_KNEE_DB) * full;
    }
    gainDb = nextEnvCoef * gainDb + (1 - nextEnvCoef) * (nextAmount * desiredDb);

    const g = dbToGain(gainDb);
    for (let c = 0; c < ch; c++) out.channels[c][i] = clampSample(d.channels[c][i] * g);
  }
  return out;
}
