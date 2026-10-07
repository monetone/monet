// ─────────────────────────────────────────────────────────────
// engine/dsp/exciter — Adobe Audition–style Harmonic Exciter
// ─────────────────────────────────────────────────────────────
// A parallel harmonic enhancer (the "Exciter" from Audition's Mastering rack).
// It isolates the high band with a high-pass, drives that band through a soft
// non-linearity to SYNTHESIZE new harmonics (an exciter creates content, unlike
// an EQ which only boosts what is already there), then blends the result back
// into the dry signal for added air/sparkle. Because only the high band is
// saturated and it is mixed in parallel, the body of the signal stays clean —
// distinct from Distortion (whole-signal clip) and the Tube compressor. Tape =
// symmetric tanh (odd harmonics); Tube = asymmetric tanh (even harmonics); Retro
// = harder drive. Pure `(AudioData, opts) => AudioData`; the input is not mutated.

import { cloneAudioData } from "../audio/buffer";
import { clamp, clampSample, dbToGain } from "../audio/db";
import { frameCount, type AudioData } from "../audio/types";
import { designBiquad } from "./biquad";
import { highpass } from "./filter";

export type ExciterMode = "tape" | "retro" | "tube";

export interface ExciterOptions {
  /** High-pass corner isolating the band to excite, in Hz. Default 3000. */
  frequency?: number;
  /** Drive into the non-linearity, in dB. Default 12. */
  driveDb?: number;
  /** Amount of the excited band blended into the dry signal, 0…1. Default 0.3. */
  mix?: number;
  /** Saturation flavour. Default "tape". */
  mode?: ExciterMode;
  automation?: ExciterAutomationOptions;
}

type ExciterParamResolver = (timeSeconds: number, fallback: number) => number;

export interface ExciterAutomationOptions {
  offsetSeconds?: number;
  frequency?: ExciterParamResolver;
  driveDb?: ExciterParamResolver;
  mix?: ExciterParamResolver;
}

const TUBE_BIAS = 0.3;
const TUBE_OFFSET = Math.tanh(TUBE_BIAS);

/** Per-mode soft saturation. Tape/Retro are symmetric (odd); Tube is asymmetric (even). */
function saturate(x: number, mode: ExciterMode): number {
  switch (mode) {
    case "retro":
      return Math.tanh(1.8 * x);
    case "tube":
      // Asymmetric tanh — the DC-removed bias makes the transfer curve uneven,
      // which synthesizes even harmonics (2f) the symmetric modes never produce.
      return Math.tanh(x + TUBE_BIAS) - TUBE_OFFSET;
    case "tape":
    default:
      return Math.tanh(x);
  }
}

function dynamicHighpass(d: AudioData, frequency: number, resolver: ExciterParamResolver, offsetSeconds: number): AudioData {
  const out = cloneAudioData(d);
  const sampleRate = d.sampleRate;
  const maxFreq = sampleRate / 2 - 1;
  for (let pass = 0; pass < 2; pass++) {
    for (const samples of out.channels) {
      let z1 = 0;
      let z2 = 0;
      for (let i = 0; i < samples.length; i++) {
        const time = offsetSeconds + i / sampleRate;
        const coeffs = designBiquad({ type: "highpass", freq: clamp(resolver(time, frequency), 200, maxFreq), q: Math.SQRT1_2 }, sampleRate);
        const x = samples[i];
        const y = coeffs.b0 * x + z1;
        z1 = coeffs.b1 * x - coeffs.a1 * y + z2;
        z2 = coeffs.b2 * x - coeffs.a2 * y;
        samples[i] = y;
      }
    }
  }
  return out;
}

/**
 * Apply the harmonic exciter. The high band (above `frequency`) is driven and
 * saturated to generate harmonics, then `mix` of that is added to the dry
 * signal. `mix: 0` is an exact passthrough. Frame count is preserved and the
 * input is not mutated.
 */
export function exciter(d: AudioData, opts: ExciterOptions = {}): AudioData {
  const out = cloneAudioData(d);
  const mix = opts.mix ?? 0.3;
  const frequency = opts.frequency ?? 3000;
  const driveDb = opts.driveDb ?? 12;
  const drive = dbToGain(driveDb);
  const mode = opts.mode ?? "tape";
  const n = frameCount(d);
  const automation = opts.automation;
  if (n === 0 || (clamp(mix, 0, 1) === 0 && !automation?.mix)) return out;
  const staticMix = clamp(mix, 0, 1);
  const offset = automation?.offsetSeconds ?? 0;
  const hasTimeVaryingFrequency = !!automation?.frequency;
  const hasTimeVaryingDrive = !!automation?.driveDb;
  const hasTimeVaryingMix = !!automation?.mix;

  // Isolate the high band to excite: two cascaded Q=0.707 biquads ≈ 24 dB/oct,
  // so the body of the signal stays out of the saturator.
  const high = hasTimeVaryingFrequency ? dynamicHighpass(d, frequency, automation.frequency!, offset) : highpass(d, frequency, Math.SQRT1_2, 2);
  for (let c = 0; c < d.channels.length; c++) {
    const dry = d.channels[c];
    const hi = high.channels[c];
    const dst = out.channels[c];
    for (let i = 0; i < n; i++) {
      const time = offset + i / d.sampleRate;
      const nextDrive = hasTimeVaryingDrive ? dbToGain(automation?.driveDb?.(time, driveDb) ?? driveDb) : drive;
      const nextMix = hasTimeVaryingMix ? clamp(automation?.mix?.(time, mix) ?? mix, 0, 1) : staticMix;
      dst[i] = clampSample(dry[i] + nextMix * saturate(hi[i] * nextDrive, mode));
    }
  }
  return out;
}
