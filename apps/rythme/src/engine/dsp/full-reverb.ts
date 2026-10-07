// ─────────────────────────────────────────────────────────────
// engine/dsp/full-reverb — Adobe Audition–style Full Reverb
// ─────────────────────────────────────────────────────────────
// Audition's Reverb ▸ Full Reverb: a convolution-based reverb (so it avoids the
// metallic ringing of algorithmic networks) built from a *synthesized* impulse
// response with four signature controls:
//   • Decay Time  — RT60 of the diffuse tail (ms to fall 60 dB).
//   • Perception  — room irregularity: more, more-varied discrete early
//     reflections (spacious, natural) vs. fewer/smoother (artificial).
//   • Coloration  — a 3-band parametric EQ that shapes the tail's frequency
//     absorption (cutting highs simulates carpet/people; keeping them simulates
//     bare auditoriums). THIS is what distinguishes Full Reverb from the plain
//     decaying-noise Convolution Reverb and the comb/allpass Studio Reverb.
//   • Absorption  — progressive high-frequency damping as the tail decays.
//
// The IR is built once (early reflections + decaying-noise tail), run through the
// Coloration EQ, energy-normalized, then convolved with the dry/wet mix. Pure
// `(AudioData, opts) => AudioData`; the input is never mutated.

import { cloneAudioData, createAudioData } from "../audio/buffer";
import { clamp } from "../audio/db";
import { frameCount, type AudioData } from "../audio/types";
import { bipolar, mulberry32 } from "../generate/rng";
import { convolve } from "./delay";
import { parametricEQ, type EQBand } from "./eq";

/** Three-band parametric EQ shaping the reverb tail (negative high = absorption). */
export interface FullReverbColoration {
  lowDb?: number;
  lowFreq?: number;
  midDb?: number;
  midFreq?: number;
  midQ?: number;
  highDb?: number;
  highFreq?: number;
}

export interface FullReverbOptions {
  /** Decay time (RT60) in ms — how long the tail takes to fall 60 dB. Default 1500. */
  decayMs?: number;
  /** Room irregularity 0…100: higher = more, more-varied early reflections. Default 40. */
  perception?: number;
  /** Pre-delay before the tail builds, in ms. Default 0. */
  preDelayMs?: number;
  /** Progressive HF damping of the tail, 0…1 (darker = more absorbent). Default 0.35. */
  absorption?: number;
  /** Coloration EQ on the tail. Default = a gentle high-frequency absorption shelf. */
  coloration?: FullReverbColoration;
  /** Dry/wet mix, 0…1. Default 0.3. */
  mix?: number;
  /** RNG seed for the synthesized IR (deterministic). Default 1. */
  seed?: number;
  automation?: FullReverbAutomationOptions;
}

type FullReverbParamResolver = (timeSeconds: number, fallback: number) => number;

export interface FullReverbAutomationOptions {
  offsetSeconds?: number;
  decayMs?: FullReverbParamResolver;
  perception?: FullReverbParamResolver;
  preDelayMs?: FullReverbParamResolver;
  absorption?: FullReverbParamResolver;
  colorLowDb?: FullReverbParamResolver;
  colorLowFreq?: FullReverbParamResolver;
  colorMidDb?: FullReverbParamResolver;
  colorMidFreq?: FullReverbParamResolver;
  colorMidQ?: FullReverbParamResolver;
  colorHighDb?: FullReverbParamResolver;
  colorHighFreq?: FullReverbParamResolver;
  mix?: FullReverbParamResolver;
}

const MIN_DECAY_MS = 20;
const MAX_DECAY_MS = 6000;
const DEFAULT_COLORATION: FullReverbColoration = { highDb: -6, highFreq: 6000 };

/** Build the Coloration parametric-EQ band list (skips flat bands). */
function colorationBands(c: FullReverbColoration): EQBand[] {
  const bands: EQBand[] = [];
  if (c.lowDb) bands.push({ type: "lowshelf", freq: c.lowFreq ?? 200, gainDb: c.lowDb });
  if (c.midDb) bands.push({ type: "peaking", freq: c.midFreq ?? 1000, q: c.midQ ?? 1, gainDb: c.midDb });
  if (c.highDb) bands.push({ type: "highshelf", freq: c.highFreq ?? 6000, gainDb: c.highDb });
  return bands;
}

function hasImpulseAutomation(automation: FullReverbAutomationOptions | undefined): boolean {
  return !!(
    automation?.decayMs ||
    automation?.perception ||
    automation?.preDelayMs ||
    automation?.absorption ||
    automation?.colorLowDb ||
    automation?.colorLowFreq ||
    automation?.colorMidDb ||
    automation?.colorMidFreq ||
    automation?.colorMidQ ||
    automation?.colorHighDb ||
    automation?.colorHighFreq
  );
}

function resolvedColoration(opts: FullReverbOptions, automation: FullReverbAutomationOptions, time: number): FullReverbColoration | undefined {
  const hasColorAutomation = !!(
    automation.colorLowDb ||
    automation.colorLowFreq ||
    automation.colorMidDb ||
    automation.colorMidFreq ||
    automation.colorMidQ ||
    automation.colorHighDb ||
    automation.colorHighFreq
  );
  if (!hasColorAutomation) return opts.coloration;
  const base = opts.coloration === undefined ? DEFAULT_COLORATION : opts.coloration;
  return {
    ...base,
    lowDb: automation.colorLowDb ? clamp(automation.colorLowDb(time, base.lowDb ?? 0), -36, 12) : base.lowDb,
    lowFreq: automation.colorLowFreq ? clamp(automation.colorLowFreq(time, base.lowFreq ?? 200), 20, 20000) : base.lowFreq,
    midDb: automation.colorMidDb ? clamp(automation.colorMidDb(time, base.midDb ?? 0), -36, 12) : base.midDb,
    midFreq: automation.colorMidFreq ? clamp(automation.colorMidFreq(time, base.midFreq ?? 1000), 20, 20000) : base.midFreq,
    midQ: automation.colorMidQ ? clamp(automation.colorMidQ(time, base.midQ ?? 1), 0.1, 50) : base.midQ,
    highDb: automation.colorHighDb ? clamp(automation.colorHighDb(time, base.highDb ?? 0), -36, 12) : base.highDb,
    highFreq: automation.colorHighFreq ? clamp(automation.colorHighFreq(time, base.highFreq ?? 6000), 20, 20000) : base.highFreq,
  };
}

function resolvedImpulseOptions(opts: FullReverbOptions, automation: FullReverbAutomationOptions, time: number): FullReverbOptions {
  const decayMs = clamp(automation.decayMs ? automation.decayMs(time, opts.decayMs ?? 1500) : opts.decayMs ?? 1500, MIN_DECAY_MS, MAX_DECAY_MS);
  const perception = clamp(automation.perception ? automation.perception(time, opts.perception ?? 40) : opts.perception ?? 40, 0, 100);
  const preDelayMs = clamp(automation.preDelayMs ? automation.preDelayMs(time, opts.preDelayMs ?? 0) : opts.preDelayMs ?? 0, 0, 500);
  const absorption = clamp(automation.absorption ? automation.absorption(time, opts.absorption ?? 0.35) : opts.absorption ?? 0.35, 0, 0.999);
  return {
    decayMs,
    perception,
    preDelayMs,
    absorption,
    coloration: resolvedColoration(opts, automation, time),
    seed: opts.seed,
  };
}

function impulseKey(opts: FullReverbOptions): string {
  return JSON.stringify({
    decayMs: opts.decayMs,
    perception: opts.perception,
    preDelayMs: opts.preDelayMs,
    absorption: opts.absorption,
    coloration: opts.coloration,
    seed: opts.seed ?? 1,
  });
}

function hasNonZeroSample(d: AudioData, frame: number): boolean {
  for (const channel of d.channels) {
    if (channel[frame] !== 0) return true;
  }
  return false;
}

function dynamicImpulseConvolve(d: AudioData, opts: FullReverbOptions, automation: FullReverbAutomationOptions): AudioData {
  const n = frameCount(d);
  const sr = d.sampleRate;
  const offset = automation.offsetSeconds ?? 0;
  const impulseCache = new Map<string, Float32Array>();
  const frameImpulses = new Array<Float32Array | undefined>(n);

  const impulseForTime = (time: number): Float32Array => {
    const impulseOpts = resolvedImpulseOptions(opts, automation, time);
    const key = impulseKey(impulseOpts);
    const cached = impulseCache.get(key);
    if (cached) return cached;
    const impulse = buildImpulse(sr, impulseOpts);
    impulseCache.set(key, impulse);
    return impulse;
  };

  let outputFrames = Math.max(n, n + impulseForTime(offset).length - 1);
  for (let i = 0; i < n; i++) {
    if (!hasNonZeroSample(d, i)) continue;
    const impulse = impulseForTime(offset + i / sr);
    frameImpulses[i] = impulse;
    outputFrames = Math.max(outputFrames, i + impulse.length);
  }

  const out = createAudioData(d.channels.length, outputFrames, sr);
  for (let i = 0; i < n; i++) {
    const impulse = frameImpulses[i];
    if (!impulse) continue;
    for (let c = 0; c < d.channels.length; c++) {
      const x = d.channels[c][i];
      if (x === 0) continue;
      const dst = out.channels[c];
      for (let k = 0; k < impulse.length; k++) dst[i + k] += x * impulse[k];
    }
  }
  return out;
}

function applyWetDryMix(d: AudioData, wet: AudioData, mix: number, automation: FullReverbAutomationOptions | undefined): AudioData {
  const n = frameCount(d);
  const offset = automation?.offsetSeconds ?? 0;
  for (let c = 0; c < wet.channels.length; c++) {
    const dry = d.channels[c];
    const dst = wet.channels[c];
    for (let i = 0; i < dst.length; i++) {
      const nextMix = automation?.mix ? clamp(automation.mix(offset + i / wet.sampleRate, mix), 0, 1) : mix;
      dst[i] = (i < n ? dry[i] : 0) * (1 - nextMix) + dst[i] * nextMix;
    }
  }
  return wet;
}

/** Synthesize the Full Reverb impulse response (early reflections + diffuse tail). */
function buildImpulse(sampleRate: number, opts: FullReverbOptions): Float32Array {
  const decayMs = clamp(opts.decayMs ?? 1500, MIN_DECAY_MS, MAX_DECAY_MS);
  const perception = clamp(opts.perception ?? 40, 0, 100) / 100;
  const decayN = Math.max(1, Math.round((decayMs / 1000) * sampleRate));
  const pre = Math.max(0, Math.round(((opts.preDelayMs ?? 0) / 1000) * sampleRate));
  const absorption = clamp(opts.absorption ?? 0.35, 0, 0.999);
  const rng = mulberry32(opts.seed ?? 1);
  const ir = new Float32Array(pre + decayN);
  const k = -6.907755 / decayN; // exp(k·decayN) ≈ −60 dB at the tail's end

  // Diffuse tail: decaying noise with a one-pole low-pass for progressive absorption.
  let lp = 0;
  for (let i = 0; i < decayN; i++) {
    const v = bipolar(rng) * Math.exp(k * i);
    lp = lp * absorption + v * (1 - absorption);
    ir[pre + i] = lp;
  }

  // Early reflections: discrete taps in the first window. Perception scales both
  // the count and the amplitude variation (more variation → more distinct echoes).
  const earlyWindowN = Math.min(decayN, Math.max(1, Math.round(((15 + perception * 120) / 1000) * sampleRate)));
  const numEarly = Math.round(4 + perception * 18);
  for (let j = 0; j < numEarly; j++) {
    const pos = Math.min(earlyWindowN - 1, Math.floor(rng() * earlyWindowN));
    const variation = 1 - perception * 0.8 * rng(); // higher perception → bigger swings
    const amp = Math.exp(k * pos) * variation * (0.5 + 0.5 * rng()) * 0.8;
    ir[pre + pos] += bipolar(rng) >= 0 ? amp : -amp;
  }

  // Coloration: shape the tail's spectrum with the 3-band parametric EQ.
  const bands = colorationBands(opts.coloration ?? DEFAULT_COLORATION);
  let colored: Float32Array = ir;
  if (bands.length) colored = parametricEQ({ sampleRate, channels: [ir] }, bands).channels[0];

  // Energy-normalize so the wet level is independent of decay/coloration choices.
  let energy = 0;
  for (let i = 0; i < colored.length; i++) energy += colored[i] * colored[i];
  const norm = energy > 0 ? 1 / Math.sqrt(energy) : 1;
  const out = new Float32Array(colored.length);
  for (let i = 0; i < colored.length; i++) out[i] = colored[i] * norm;
  return out;
}

/**
 * Full Reverb. Returns a buffer extended by the IR tail (channel count
 * preserved); the input is not mutated. Convolution is O(n · irLength), so long
 * decay times over long material are expensive — as with Convolution Reverb.
 */
export function fullReverb(d: AudioData, opts: FullReverbOptions = {}): AudioData {
  if (frameCount(d) === 0) return cloneAudioData(d);
  const mix = clamp(opts.mix ?? 0.3, 0, 1);
  const automation = opts.automation;
  if (!automation || !hasImpulseAutomation(automation)) {
    const impulse = buildImpulse(d.sampleRate, opts);
    if (!automation?.mix) return convolve(d, impulse, mix);
    return applyWetDryMix(d, convolve(d, impulse, 1), mix, automation);
  }

  return applyWetDryMix(d, dynamicImpulseConvolve(d, opts, automation), mix, automation);
}
