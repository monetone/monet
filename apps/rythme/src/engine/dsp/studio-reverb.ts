// ─────────────────────────────────────────────────────────────
// engine/dsp/studio-reverb — Adobe Audition–style Studio Reverb
// ─────────────────────────────────────────────────────────────
// A fast algorithmic reverb built around EARLY REFLECTIONS: the discrete first
// echoes off nearby surfaces that arrive just after the dry sound and give a
// room its sense of size and position. `earlyReflections` is a multi-tap delay
// (the new primitive); `studioReverb` blends those early taps with the engine's
// Freeverb diffuse tail and the dry signal. Distinct from Reverb/Freeverb (which
// has no explicit early-reflection taps) and Convolution Reverb (IR-based). Like
// the other reverbs the output extends the buffer by a ring-out tail. Pure
// `(AudioData, opts) => AudioData`; the input is never mutated.

import { setChannelCount } from "../audio/buffer";
import { clamp, clampSample } from "../audio/db";
import { frameCount, type AudioData } from "../audio/types";
import { reverb } from "./reverb";

/** Normalised early-reflection pattern: tap time (fraction of earlyMs) + gain. */
const ER_TAPS: { t: number; g: number }[] = [
  { t: 0.1, g: 0.9 },
  { t: 0.21, g: 0.72 },
  { t: 0.34, g: 0.6 },
  { t: 0.49, g: 0.5 },
  { t: 0.66, g: 0.42 },
  { t: 0.82, g: 0.33 },
  { t: 1.0, g: 0.26 },
];

export interface EarlyReflectionsOptions {
  /** Total spread of the reflection pattern, ms. Default 80. */
  earlyMs?: number;
  /** Output gain of the reflections, 0…1. Default 1. */
  level?: number;
  /** Stereo decorrelation (time-stretches the right channel), 0…1. Default 0.7. */
  width?: number;
  /** Ring-out padding appended after the dry, seconds. Default earlyMs + 50 ms.
   *  Should be at least earlyMs/1000 so the latest tap lands inside the output. */
  tailSeconds?: number;
  automation?: EarlyReflectionsAutomationOptions;
}

type EarlyReflectionsParamResolver = (timeSeconds: number, fallback: number) => number;

export interface EarlyReflectionsAutomationOptions {
  offsetSeconds?: number;
  width?: EarlyReflectionsParamResolver;
}

/**
 * Early reflections: a fixed pattern of delayed, decaying taps of the dry
 * signal. Mono is up-mixed; output is always stereo and is `tailSeconds` longer
 * than the input so the late taps are not cut. A unit impulse yields the tap
 * gains exactly at the tap delays. The input is not mutated.
 */
export function earlyReflections(d: AudioData, opts: EarlyReflectionsOptions = {}): AudioData {
  const earlyMs = opts.earlyMs ?? 80;
  const level = clamp(opts.level ?? 1, 0, 1);
  const width = clamp(opts.width ?? 0.7, 0, 1);
  const sr = d.sampleRate;
  const stereo = setChannelCount(d, 2);
  const n = frameCount(stereo);
  const tail = Math.round((opts.tailSeconds ?? earlyMs / 1000 + 0.05) * sr); // default tail = (earlyMs/1000) + 50 ms
  const len = n + tail;
  const baseSamp = (earlyMs / 1000) * sr;
  const automation = opts.automation;
  const offset = automation?.offsetSeconds ?? 0;
  const hasTimeVaryingWidth = !!automation?.width;

  const out: AudioData = { sampleRate: sr, channels: [new Float32Array(len), new Float32Array(len)] };
  for (let ch = 0; ch < 2; ch++) {
    const src = stereo.channels[ch];
    const dst = out.channels[ch];
    for (const tap of ER_TAPS) {
      if (ch === 1 && hasTimeVaryingWidth) {
        const g = tap.g * level;
        for (let j = 0; j < len; j++) {
          const time = offset + j / sr;
          const nextWidth = clamp(automation?.width?.(time, width) ?? width, 0, 1);
          const delay = Math.round(tap.t * baseSamp * (1 + 0.25 * nextWidth));
          const sourceIndex = j - delay;
          if (sourceIndex >= 0 && sourceIndex < n) dst[j] += src[sourceIndex] * g;
        }
        continue;
      }
      const stretch = ch === 1 ? 1 + 0.25 * width : 1; // right taps arrive later → wider image
      const delay = Math.round(tap.t * baseSamp * stretch);
      const g = tap.g * level;
      for (let i = 0; i < n; i++) {
        const j = i + delay;
        if (j < len) dst[j] += src[i] * g;
      }
    }
  }
  return out;
}

export interface StudioReverbOptions {
  /** Tail length / room size, 0…1. Default 0.5. */
  decay?: number;
  /** High-frequency damping of the tail, 0…1. Default 0.4. */
  damping?: number;
  /** Early-reflection spread, ms. Default 80. */
  earlyMs?: number;
  /** Early-reflection blend level, 0…1. Default 0.5. */
  earlyLevel?: number;
  /** Stereo width of the early reflections, 0…1. Default 0.7. */
  width?: number;
  /** Dry/wet mix, 0…1. Default 0.3. */
  mix?: number;
  /** Ring-out tail appended after the dry, seconds. Default 1.5. */
  tailSeconds?: number;
  automation?: StudioReverbAutomationOptions;
}

type StudioReverbParamResolver = (timeSeconds: number, fallback: number) => number;

export interface StudioReverbAutomationOptions {
  offsetSeconds?: number;
  decay?: StudioReverbParamResolver;
  damping?: StudioReverbParamResolver;
  earlyLevel?: StudioReverbParamResolver;
  width?: StudioReverbParamResolver;
  mix?: StudioReverbParamResolver;
}

/**
 * Studio Reverb: early reflections + a damped Freeverb tail, blended with the
 * dry signal by `mix`. Output is stereo and `tailSeconds` longer than the input.
 * `mix: 0` leaves the dry signal untouched (with a silent tail). Not mutating.
 */
export function studioReverb(d: AudioData, opts: StudioReverbOptions = {}): AudioData {
  const decay = clamp(opts.decay ?? 0.5, 0, 1);
  const damping = clamp(opts.damping ?? 0.4, 0, 1);
  const earlyMs = opts.earlyMs ?? 80;
  const earlyLevel = clamp(opts.earlyLevel ?? 0.5, 0, 1);
  const width = clamp(opts.width ?? 0.7, 0, 1);
  const mix = clamp(opts.mix ?? 0.3, 0, 1);
  const sr = d.sampleRate;
  const stereo = setChannelCount(d, 2);
  const n = frameCount(stereo);
  const tailSeconds = opts.tailSeconds ?? 1.5;
  const len = n + Math.round(tailSeconds * sr);
  const automation = opts.automation;
  const offset = automation?.offsetSeconds ?? 0;
  const hasTimeVaryingDecay = !!automation?.decay;
  const hasTimeVaryingDamping = !!automation?.damping;
  const hasTimeVaryingEarlyLevel = !!automation?.earlyLevel;
  const hasTimeVaryingWidth = !!automation?.width;
  const hasTimeVaryingMix = !!automation?.mix;

  const early = earlyReflections(stereo, {
    earlyMs,
    level: 1,
    width,
    tailSeconds,
    automation: hasTimeVaryingWidth ? { offsetSeconds: offset, width: automation?.width } : undefined,
  });
  const late = reverb(stereo, {
    roomSize: decay,
    damping,
    wet: 1,
    dry: 0,
    tailSeconds,
    automation:
      hasTimeVaryingDecay || hasTimeVaryingDamping
        ? {
            offsetSeconds: offset,
            roomSize: automation?.decay,
            damping: automation?.damping,
          }
        : undefined,
  });

  const out: AudioData = { sampleRate: sr, channels: [new Float32Array(len), new Float32Array(len)] };
  for (let ch = 0; ch < 2; ch++) {
    const dry = stereo.channels[ch];
    const e = early.channels[ch]; // guaranteed length `len` (same tailSeconds/sr/n)
    const l = late.channels[ch]; // guaranteed length `len`
    const dst = out.channels[ch];
    for (let i = 0; i < len; i++) {
      const time = offset + i / sr;
      const nextEarlyLevel = hasTimeVaryingEarlyLevel ? clamp(automation?.earlyLevel?.(time, earlyLevel) ?? earlyLevel, 0, 1) : earlyLevel;
      const nextMix = hasTimeVaryingMix ? clamp(automation?.mix?.(time, mix) ?? mix, 0, 1) : mix;
      const dryS = i < n ? dry[i] : 0;
      // `earlyLevel` is an independent early-reflection gain (as in Audition,
      // early reflections and the tail are separate levels), not a crossfade —
      // the Freeverb tail carries its own level (its internal FIXED_GAIN).
      dst[i] = clampSample((1 - nextMix) * dryS + nextMix * (nextEarlyLevel * e[i] + l[i]));
    }
  }
  return out;
}
