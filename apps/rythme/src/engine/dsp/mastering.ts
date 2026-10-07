// ─────────────────────────────────────────────────────────────
// engine/dsp/mastering — Adobe Audition–style Mastering rack
// ─────────────────────────────────────────────────────────────
// A one-stop master-bus chain (Audition's Special ▸ Mastering). The wet path
// strings together the engine's existing, individually-tested blocks into a
// finished master:
//   EQ tilt (low + high shelf) → Exciter (high-frequency sparkle) →
//   Widener (stereo image) → optional Ambience → Loudness Maximizer (drive +
//   brickwall limit). The whole chain is blended with the dry by an overall
// `amount`. The default chain stays length-preserving; enabling `ambience`
// appends the reverb tail Audition's rack exposes. Distinct from the Vocal
// Enhancer and Guitar Suite chains — different stages, master-bus purpose. Pure
// `(AudioData, opts) => AudioData`; the input is never mutated.

import { cloneAudioData, createAudioData } from "../audio/buffer";
import { clamp, clampSample } from "../audio/db";
import { channelCount, frameCount, type AudioData } from "../audio/types";
import { applyBiquad, designBiquad, type BiquadType } from "./biquad";
import { stereoWidth } from "./basic";
import { convolutionReverb } from "./convolution-reverb";
import { exciter } from "./exciter";
import { hardLimiter, type HardLimiterAutomationOptions } from "./limiter";

export interface MasteringOptions {
  /** Low-shelf gain for weight, dB. Default 1. */
  lowShelfDb?: number;
  /** High-shelf gain for brightness/air, dB. Default 2. */
  highShelfDb?: number;
  /** Exciter blend for high-frequency sparkle, 0…1. Default 0.2. */
  exciteAmount?: number;
  /** Stereo width multiplier (1 = unchanged, >1 = wider). Default 1.3. */
  width?: number;
  /** Ambience/reverb blend before maximizing, 0…1. Default 0 (off). */
  ambience?: number;
  /** Ambience decay time, ms. Default 250. */
  ambienceDecayMs?: number;
  /** Ambience pre-delay, ms. Default 8. */
  ambiencePreDelayMs?: number;
  /** Input drive into the loudness maximizer, dB. Default 3. */
  driveDb?: number;
  /** Output ceiling for the maximizer, dBFS. Default -1. */
  ceilingDb?: number;
  /** Overall dry/wet of the whole rack, 0…1. Default 1. */
  amount?: number;
  automation?: MasteringAutomationOptions;
}

type MasteringParamResolver = (timeSeconds: number, fallback: number) => number;

export interface MasteringAutomationOptions {
  offsetSeconds?: number;
  lowShelfDb?: MasteringParamResolver;
  highShelfDb?: MasteringParamResolver;
  driveDb?: MasteringParamResolver;
  ceilingDb?: MasteringParamResolver;
  exciteAmount?: MasteringParamResolver;
  width?: MasteringParamResolver;
  ambience?: MasteringParamResolver;
  amount?: MasteringParamResolver;
}

function masteringLimiterAutomation(automation: MasteringAutomationOptions | undefined): HardLimiterAutomationOptions | undefined {
  if (!automation?.driveDb && !automation?.ceilingDb) return undefined;
  return {
    offsetSeconds: automation.offsetSeconds,
    inputBoostDb: automation.driveDb,
    ceilingDb: automation.ceilingDb,
  };
}

function applyDynamicShelf(
  d: AudioData,
  opts: {
    type: Extract<BiquadType, "lowshelf" | "highshelf">;
    freq: number;
    gainDb: number;
    offsetSeconds: number;
    gainResolver: MasteringParamResolver;
  },
): AudioData {
  const out = cloneAudioData(d);
  for (const samples of out.channels) {
    let z1 = 0;
    let z2 = 0;
    for (let i = 0; i < samples.length; i++) {
      const time = opts.offsetSeconds + i / d.sampleRate;
      const coeffs = designBiquad({ type: opts.type, freq: opts.freq, gainDb: opts.gainResolver(time, opts.gainDb) }, d.sampleRate);
      const x = samples[i];
      const y = coeffs.b0 * x + z1;
      z1 = coeffs.b1 * x - coeffs.a1 * y + z2;
      z2 = coeffs.b2 * x - coeffs.a2 * y;
      samples[i] = y;
    }
  }
  return out;
}

function applyStereoWidthAutomation(d: AudioData, width: number, automation: MasteringAutomationOptions | undefined): AudioData {
  if (channelCount(d) !== 2) return cloneAudioData(d);
  const staticWidth = Math.max(0, width);
  if (!automation?.width) return stereoWidth(d, staticWidth);
  const out = cloneAudioData(d);
  const offset = automation.offsetSeconds ?? 0;
  const [l, r] = out.channels;
  for (let i = 0; i < l.length; i++) {
    const nextWidth = Math.max(0, automation.width(offset + i / d.sampleRate, staticWidth));
    const mid = (d.channels[0][i] + d.channels[1][i]) / 2;
    const side = ((d.channels[0][i] - d.channels[1][i]) / 2) * nextWidth;
    l[i] = mid + side;
    r[i] = mid - side;
  }
  return out;
}

function applyAmbienceAutomation(
  d: AudioData,
  opts: { ambience: number; decayMs: number; preDelayMs: number; automation?: MasteringAutomationOptions },
): AudioData {
  const staticAmbience = clamp(opts.ambience, 0, 1);
  if (!opts.automation?.ambience) {
    if (staticAmbience === 0) return d;
    return convolutionReverb(d, {
      decaySeconds: Math.max(10, opts.decayMs) / 1000,
      preDelayMs: opts.preDelayMs,
      damping: 0.45,
      mix: staticAmbience,
      seed: 19,
    });
  }

  const wet = convolutionReverb(d, {
    decaySeconds: Math.max(10, opts.decayMs) / 1000,
    preDelayMs: opts.preDelayMs,
    damping: 0.45,
    mix: 1,
    seed: 19,
  });
  const out = createAudioData(channelCount(wet), frameCount(wet), d.sampleRate);
  const offset = opts.automation.offsetSeconds ?? 0;
  for (let c = 0; c < out.channels.length; c++) {
    const dry = d.channels[Math.min(c, d.channels.length - 1)] ?? new Float32Array(0);
    const reverb = wet.channels[c];
    const dst = out.channels[c];
    for (let i = 0; i < dst.length; i++) {
      const nextAmbience = clamp(opts.automation.ambience(offset + i / d.sampleRate, staticAmbience), 0, 1);
      dst[i] = (i < dry.length ? dry[i] : 0) * (1 - nextAmbience) + reverb[i] * nextAmbience;
    }
  }
  return out;
}

/**
 * Apply the mastering rack. `amount: 0` is an exact passthrough. Output frame
 * count equals the input unless ambience is enabled, and the input is not mutated.
 */
export function mastering(d: AudioData, opts: MasteringOptions = {}): AudioData {
  const amount = opts.amount ?? 1;
  const n = frameCount(d);
  const automation = opts.automation;
  if (n === 0 || (clamp(amount, 0, 1) === 0 && !automation?.amount)) return cloneAudioData(d);

  const lowShelfDb = opts.lowShelfDb ?? 1;
  const highShelfDb = opts.highShelfDb ?? 2;
  const exciteAmount = clamp(opts.exciteAmount ?? 0.2, 0, 1);
  const width = Math.max(0, opts.width ?? 1.3);
  const ambience = clamp(opts.ambience ?? 0, 0, 1);
  const driveDb = opts.driveDb ?? 3;
  const ceilingDb = opts.ceilingDb ?? -1;
  const staticAmount = clamp(amount, 0, 1);
  const offset = automation?.offsetSeconds ?? 0;
  const hasTimeVaryingAmount = !!automation?.amount;

  // Wet chain — each stage returns a fresh buffer, so the input is never touched.
  let wet = automation?.lowShelfDb
    ? applyDynamicShelf(d, { type: "lowshelf", freq: 120, gainDb: lowShelfDb, offsetSeconds: offset, gainResolver: automation.lowShelfDb })
    : applyBiquad(d, { type: "lowshelf", freq: 120, gainDb: lowShelfDb });
  wet = automation?.highShelfDb
    ? applyDynamicShelf(wet, { type: "highshelf", freq: 8000, gainDb: highShelfDb, offsetSeconds: offset, gainResolver: automation.highShelfDb })
    : applyBiquad(wet, { type: "highshelf", freq: 8000, gainDb: highShelfDb });
  wet = exciter(wet, {
    mix: exciteAmount,
    frequency: 4000,
    driveDb: 10,
    mode: "tape",
    automation: automation?.exciteAmount ? { offsetSeconds: offset, mix: automation.exciteAmount } : undefined,
  });
  wet = applyStereoWidthAutomation(wet, width, automation);
  wet = applyAmbienceAutomation(wet, {
    ambience,
    decayMs: opts.ambienceDecayMs ?? 250,
    preDelayMs: opts.ambiencePreDelayMs ?? 8,
    automation,
  });
  // Loudness maximizer: look-ahead brickwall that guarantees |out| ≤ ceiling.
  wet = hardLimiter(wet, { inputBoostDb: driveDb, ceilingDb, automation: masteringLimiterAutomation(automation) });

  const ch = channelCount(wet);
  const out = createAudioData(ch, frameCount(wet), d.sampleRate);
  for (let c = 0; c < ch; c++) {
    const dry = d.channels[Math.min(c, d.channels.length - 1)] ?? new Float32Array(0);
    const w = wet.channels[c];
    const dst = out.channels[c];
    for (let i = 0; i < dst.length; i++) {
      const drySample = i < n ? dry[i] : 0;
      const time = offset + i / d.sampleRate;
      const nextAmount = hasTimeVaryingAmount ? clamp(automation?.amount?.(time, amount) ?? amount, 0, 1) : staticAmount;
      dst[i] = clampSample((1 - nextAmount) * drySample + nextAmount * w[i]);
    }
  }
  return out;
}
