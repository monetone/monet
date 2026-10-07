// ─────────────────────────────────────────────────────────────
// engine/dsp/phaser — Adobe Audition–style Graphic Phase Shifter
// ─────────────────────────────────────────────────────────────
// A phaser cascades first-order allpass filters — which pass every frequency at
// unity gain but rotate its phase — and mixes the result back with the dry
// signal. Where the cascade lands 180° out of phase the two cancel (a notch);
// where they line up they reinforce (a peak). An LFO sweeps the allpass break
// frequency so the notches glide, and feedback intensifies the resonance. This
// is the allpass cousin of the delay-based flanger: more subtle, non-harmonic
// notch spacing. Pure `(AudioData, opts) => AudioData`; never mutates its input.

import { cloneAudioData, createAudioData } from "../audio/buffer";
import { clamp } from "../audio/db";
import { channelCount, frameCount, type AudioData } from "../audio/types";

export interface PhaserOptions {
  /** LFO sweep rate in Hz. */
  rateHz?: number;
  /** Number of allpass stages — higher = denser phasing (Audition "Stages"). */
  stages?: number;
  /** Sweep depth 0…1 — how far the break frequency travels. */
  depth?: number;
  /** Feedback 0…1 (negative inverts phase before feeding back). */
  feedback?: number;
  /** Wet/dry mix 0…1; 0 = dry only, 0.5 = deepest notches, 1 = full wet. */
  mix?: number;
  /** Lowest break frequency of the sweep, in Hz. */
  baseFreqHz?: number;
  /** Sweep span above the base, in octaves. */
  rangeOctaves?: number;
  automation?: PhaserAutomationOptions;
}

type PhaserParamResolver = (timeSeconds: number, fallback: number) => number;

export interface PhaserAutomationOptions {
  offsetSeconds?: number;
  rateHz?: PhaserParamResolver;
  stages?: PhaserParamResolver;
  depth?: PhaserParamResolver;
  feedback?: PhaserParamResolver;
  mix?: PhaserParamResolver;
  baseFreqHz?: PhaserParamResolver;
  rangeOctaves?: PhaserParamResolver;
}

const TWO_PI = 2 * Math.PI;
const MAX_STAGES = 24;

/**
 * Sweeping allpass phaser. The output keeps the input's channel and frame
 * count. `mix: 0` is a pass-through; even stage counts give the classic notches.
 */
export function phaser(d: AudioData, opts: PhaserOptions = {}): AudioData {
  const n = frameCount(d);
  const ch = channelCount(d);
  if (n === 0 || ch === 0) return cloneAudioData(d);

  const rate = Math.max(0, opts.rateHz ?? 0.5);
  const stages = Math.max(1, Math.floor(opts.stages ?? 4));
  const depth = clamp(opts.depth ?? 1, 0, 1);
  const feedback = clamp(opts.feedback ?? 0.3, -0.95, 0.95);
  const mix = clamp(opts.mix ?? 0.5, 0, 1);
  const baseFreq = Math.max(20, opts.baseFreqHz ?? 300);
  const rangeOct = Math.max(0, opts.rangeOctaves ?? 4);
  const sr = d.sampleRate;
  const nyq = sr * 0.45;
  const automation = opts.automation;
  const offset = automation?.offsetSeconds ?? 0;
  const hasTimeVaryingRate = !!automation?.rateHz;
  const hasTimeVaryingStages = !!automation?.stages;
  const hasTimeVaryingDepth = !!automation?.depth;
  const hasTimeVaryingFeedback = !!automation?.feedback;
  const hasTimeVaryingMix = !!automation?.mix;
  const hasTimeVaryingBaseFreq = !!automation?.baseFreqHz;
  const hasTimeVaryingRange = !!automation?.rangeOctaves;

  const out = createAudioData(ch, n, sr);
  // Per-channel allpass state (previous input/output per stage) + feedback memory.
  const xPrev: Float64Array[] = [];
  const yPrev: Float64Array[] = [];
  const fbState = new Float64Array(ch);
  const stateStages = hasTimeVaryingStages ? MAX_STAGES : stages;
  for (let c = 0; c < ch; c++) {
    xPrev.push(new Float64Array(stateStages));
    yPrev.push(new Float64Array(stateStages));
  }

  let lfoPhase = 0;
  for (let i = 0; i < n; i++) {
    const time = offset + i / sr;
    const nextRate = hasTimeVaryingRate ? Math.max(0, automation?.rateHz?.(time, rate) ?? rate) : rate;
    const nextStages = hasTimeVaryingStages ? Math.round(clamp(automation?.stages?.(time, stages) ?? stages, 1, MAX_STAGES)) : stages;
    const nextDepth = hasTimeVaryingDepth ? clamp(automation?.depth?.(time, depth) ?? depth, 0, 1) : depth;
    const nextBaseFreq = hasTimeVaryingBaseFreq ? clamp(automation?.baseFreqHz?.(time, baseFreq) ?? baseFreq, 20, nyq) : baseFreq;
    const nextRangeOct = hasTimeVaryingRange ? Math.max(0, automation?.rangeOctaves?.(time, rangeOct) ?? rangeOct) : rangeOct;
    // LFO 0…1 → break frequency (shared across channels for a coherent image).
    const lfo = (Math.sin(lfoPhase) + 1) / 2;
    let fc = nextBaseFreq * Math.pow(2, lfo * nextDepth * nextRangeOct);
    if (fc > nyq) fc = nyq;
    const t = Math.tan((Math.PI * fc) / sr);
    const a = (t - 1) / (t + 1); // first-order allpass coefficient, |a| < 1
    const nextFeedback = hasTimeVaryingFeedback ? clamp(automation?.feedback?.(time, feedback) ?? feedback, -0.95, 0.95) : feedback;
    const nextMix = hasTimeVaryingMix ? clamp(automation?.mix?.(time, mix) ?? mix, 0, 1) : mix;

    for (let c = 0; c < ch; c++) {
      const xp = xPrev[c];
      const yp = yPrev[c];
      const dry = d.channels[c][i];
      let s = dry + nextFeedback * fbState[c];
      for (let st = 0; st < nextStages; st++) {
        const y = a * s + xp[st] - a * yp[st]; // H(z) = (a + z⁻¹)/(1 + a z⁻¹)
        xp[st] = s;
        yp[st] = y;
        s = y;
      }
      fbState[c] = s;
      out.channels[c][i] = (1 - nextMix) * dry + nextMix * s;
    }
    lfoPhase += (TWO_PI * nextRate) / sr;
  }
  return out;
}
