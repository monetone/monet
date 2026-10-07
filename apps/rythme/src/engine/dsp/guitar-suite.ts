// ─────────────────────────────────────────────────────────────
// engine/dsp/guitar-suite — Adobe Audition–style Guitar Suite
// ─────────────────────────────────────────────────────────────
// A guitar amp / stompbox chain (Audition's Special ▸ Guitar Suite). The wet
// path strings together the engine's existing blocks into a voiced guitar tone:
//   compress (sustain) → softClip overdrive (edge + harmonics) → cabinet voicing
//   (body high-pass · tone low-pass · presence peak) → dry/wet mix.
// The cabinet stage is what makes it sound like an amp rather than raw fuzz: it
// trims the sub-bass rumble and the harsh high fizz and lifts the presence band,
// the way a real guitar speaker does. Distinct from the bare Distortion effect
// (whole-signal clip, no voicing). Pure `(AudioData, opts) => AudioData`; the
// input is never mutated.

import { cloneAudioData, mapSamples } from "../audio/buffer";
import { clamp, clampSample, dbToGain } from "../audio/db";
import { frameCount, type AudioData } from "../audio/types";
import { applyBiquad, designBiquad, type BiquadType } from "./biquad";
import { softClip } from "./distortion";
import { compress } from "./dynamics";
import { highpass, lowpass } from "./filter";

/** Distortion character — shifts how hard the signal hits the overdrive. */
export type GuitarAmpMode = "clean" | "crunch" | "lead";

export interface GuitarSuiteOptions {
  /** Overdrive drive into the amp non-linearity, dB. Default 12. */
  driveDb?: number;
  /** Distortion character (shifts the effective drive). Default "crunch". */
  mode?: GuitarAmpMode;
  /** Cabinet body: high-pass corner removing sub rumble, Hz. Default 90. */
  bodyHz?: number;
  /** Cabinet tone: low-pass corner removing high fizz, Hz. Default 5000. */
  toneHz?: number;
  /** Presence peak (~3 kHz) gain, dB. Default 3. */
  presenceDb?: number;
  /** Pre-compress for sustain. Default true. */
  compress?: boolean;
  /** Dry/wet mix, 0…1. Default 1 (fully processed). */
  mix?: number;
  /** Output makeup gain, dB. Default 0. */
  outputDb?: number;
  automation?: GuitarSuiteAutomationOptions;
}

type GuitarSuiteParamResolver = (timeSeconds: number, fallback: number) => number;

export interface GuitarSuiteAutomationOptions {
  offsetSeconds?: number;
  driveDb?: GuitarSuiteParamResolver;
  bodyHz?: GuitarSuiteParamResolver;
  toneHz?: GuitarSuiteParamResolver;
  presenceDb?: GuitarSuiteParamResolver;
  mix?: GuitarSuiteParamResolver;
  outputDb?: GuitarSuiteParamResolver;
}

/** How each mode shifts the drive (dB) into the overdrive stage. */
const MODE_DRIVE_DB: Record<GuitarAmpMode, number> = { clean: -6, crunch: 0, lead: 8 };

function softClipSample(sample: number, driveDb: number): number {
  const drive = dbToGain(driveDb);
  const norm = Math.tanh(drive) || 1;
  return Math.tanh(sample * drive) / norm;
}

function applyDynamicBiquadCascade(
  d: AudioData,
  opts: {
    type: BiquadType;
    passes?: number;
    q?: number;
    freq: number;
    gainDb?: number;
    offsetSeconds: number;
    freqResolver?: GuitarSuiteParamResolver;
    gainResolver?: GuitarSuiteParamResolver;
  },
): AudioData {
  let out = cloneAudioData(d);
  const passes = Math.max(1, opts.passes ?? 1);
  const maxFreq = d.sampleRate / 2 - 1;
  for (let pass = 0; pass < passes; pass++) {
    const next = cloneAudioData(out);
    for (let c = 0; c < out.channels.length; c++) {
      const input = out.channels[c];
      const dst = next.channels[c];
      let z1 = 0;
      let z2 = 0;
      for (let i = 0; i < input.length; i++) {
        const time = opts.offsetSeconds + i / d.sampleRate;
        const freq = clamp(opts.freqResolver?.(time, opts.freq) ?? opts.freq, 20, maxFreq);
        const gainDb = opts.gainResolver?.(time, opts.gainDb ?? 0) ?? opts.gainDb;
        const coeffs = designBiquad({ type: opts.type, freq, q: opts.q, gainDb }, d.sampleRate);
        const x = input[i];
        const y = coeffs.b0 * x + z1;
        z1 = coeffs.b1 * x - coeffs.a1 * y + z2;
        z2 = coeffs.b2 * x - coeffs.a2 * y;
        dst[i] = y;
      }
    }
    out = next;
  }
  return out;
}

/**
 * Apply the guitar amp + cabinet chain. `mix: 0` is an exact passthrough. Frame
 * count is preserved and the input is not mutated.
 */
export function guitarSuite(d: AudioData, opts: GuitarSuiteOptions = {}): AudioData {
  const out = cloneAudioData(d);
  const mix = opts.mix ?? 1;
  const n = frameCount(d);
  const automation = opts.automation;
  if (n === 0 || (clamp(mix, 0, 1) === 0 && !automation?.mix)) return out;

  const mode = opts.mode ?? "crunch";
  const driveDb = opts.driveDb ?? 12;
  const modeDriveDb = MODE_DRIVE_DB[mode];
  const bodyHz = opts.bodyHz ?? 90;
  const toneHz = opts.toneHz ?? 5000;
  const presenceDb = opts.presenceDb ?? 3;
  const outputDb = opts.outputDb ?? 0;
  const outGain = dbToGain(outputDb);
  const staticMix = clamp(mix, 0, 1);
  const offset = automation?.offsetSeconds ?? 0;
  const hasTimeVaryingDrive = !!automation?.driveDb;
  const hasTimeVaryingBody = !!automation?.bodyHz;
  const hasTimeVaryingTone = !!automation?.toneHz;
  const hasTimeVaryingPresence = !!automation?.presenceDb;
  const hasTimeVaryingMix = !!automation?.mix;
  const hasTimeVaryingOutput = !!automation?.outputDb;

  // Wet chain. Each stage returns a fresh buffer; skipping compression clones up
  // front so the no-mutation guarantee is structural, not a side effect of the
  // later stages happening to copy.
  let wet = opts.compress ?? true ? compress(d, { thresholdDb: -24, ratio: 4, attackMs: 5, releaseMs: 120, makeupDb: 6 }) : cloneAudioData(d);
  wet = hasTimeVaryingDrive
    ? mapSamples(wet, (sample, frame) => {
        const time = offset + frame / d.sampleRate;
        const nextDriveDb = (automation?.driveDb?.(time, driveDb) ?? driveDb) + modeDriveDb;
        return softClipSample(sample, nextDriveDb);
      })
    : softClip(wet, driveDb + modeDriveDb); // amp overdrive — adds the harmonic edge
  wet = hasTimeVaryingBody
    ? applyDynamicBiquadCascade(wet, {
        type: "highpass",
        freq: bodyHz,
        q: Math.SQRT1_2,
        passes: 2,
        offsetSeconds: offset,
        freqResolver: automation?.bodyHz,
      })
    : highpass(wet, bodyHz, Math.SQRT1_2, 2); // cabinet body
  wet = hasTimeVaryingTone
    ? applyDynamicBiquadCascade(wet, {
        type: "lowpass",
        freq: toneHz,
        q: Math.SQRT1_2,
        passes: 2,
        offsetSeconds: offset,
        freqResolver: automation?.toneHz,
      })
    : lowpass(wet, toneHz, Math.SQRT1_2, 2); // cabinet tone
  wet = hasTimeVaryingPresence
    ? applyDynamicBiquadCascade(wet, {
        type: "peaking",
        freq: 3000,
        q: 1,
        gainDb: presenceDb,
        offsetSeconds: offset,
        gainResolver: automation?.presenceDb,
      })
    : applyBiquad(wet, { type: "peaking", freq: 3000, q: 1, gainDb: presenceDb }); // presence

  for (let c = 0; c < d.channels.length; c++) {
    const dry = d.channels[c];
    const w = wet.channels[c];
    const dst = out.channels[c];
    for (let i = 0; i < n; i++) {
      const time = offset + i / d.sampleRate;
      const nextMix = hasTimeVaryingMix ? clamp(automation?.mix?.(time, mix) ?? mix, 0, 1) : staticMix;
      const nextOutGain = hasTimeVaryingOutput ? dbToGain(automation?.outputDb?.(time, outputDb) ?? outputDb) : outGain;
      dst[i] = clampSample(nextMix * w[i] * nextOutGain + (1 - nextMix) * dry[i]);
    }
  }
  return out;
}
