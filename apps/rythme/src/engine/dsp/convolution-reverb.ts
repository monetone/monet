// ─────────────────────────────────────────────────────────────
// engine/dsp/convolution-reverb — Adobe Audition–style Convolution Reverb
// ─────────────────────────────────────────────────────────────
// Reverb by convolving the signal with an impulse response (IR) — the sampled
// "fingerprint" of a real space — rather than the algorithmic comb/allpass
// network of Freeverb. Audition loads IR files; here we synthesize one when none
// is supplied: exponentially-decaying noise (a generic room tail), with optional
// pre-delay and high-frequency damping, energy-normalised so the wet level is
// sensible. The actual convolution + dry/wet mix reuses the engine's convolve().
// Pure `(AudioData, opts) => AudioData`; the input is never mutated.

import { cloneAudioData, mixToMono } from "../audio/buffer";
import { clamp } from "../audio/db";
import { frameCount, type AudioData } from "../audio/types";
import { bipolar, mulberry32 } from "../generate/rng";
import { convolve } from "./delay";

export interface ConvolutionReverbOptions {
  /** Reverb time / room size: IR decays to ~-60 dB over this many seconds. */
  decaySeconds?: number;
  /** Dry/wet mix, 0…1. */
  mix?: number;
  /** Pre-delay before the tail builds, in ms. */
  preDelayMs?: number;
  /** High-frequency damping of the tail, 0…1 (darker = larger). */
  damping?: number;
  /** RNG seed for the synthesized IR (deterministic). */
  seed?: number;
  /** Custom impulse response; overrides the synthesized one. */
  impulse?: Float32Array;
}

export type ImpulseResponseNormalization = "none" | "peak" | "energy";

export interface ImpulseResponseFromAudioOptions {
  /** Normalize imported IR gain before convolution. Default "energy". */
  normalize?: ImpulseResponseNormalization;
}

/** Convert imported audio into the mono kernel expected by convolutionReverb(). */
export function impulseResponseFromAudioData(d: AudioData, opts: ImpulseResponseFromAudioOptions = {}): Float32Array {
  const mono = mixToMono(d).channels[0]?.slice() ?? new Float32Array(0);
  const mode = opts.normalize ?? "energy";
  if (mode === "none" || mono.length === 0) return mono;

  let scale = 0;
  if (mode === "peak") {
    for (let i = 0; i < mono.length; i++) scale = Math.max(scale, Math.abs(mono[i]));
  } else {
    for (let i = 0; i < mono.length; i++) scale += mono[i] * mono[i];
    scale = Math.sqrt(scale);
  }
  if (scale > 0) for (let i = 0; i < mono.length; i++) mono[i] /= scale;
  return mono;
}

/** Synthesize a decaying-noise impulse response, normalized to unit energy. */
function buildImpulse(sampleRate: number, decaySeconds: number, preDelayMs: number, damping: number, seed: number): Float32Array {
  const decayN = Math.max(1, Math.round(Math.max(0.001, decaySeconds) * sampleRate));
  const pre = Math.max(0, Math.round((preDelayMs / 1000) * sampleRate));
  const ir = new Float32Array(pre + decayN);
  const rng = mulberry32(seed);
  const damp = clamp(damping, 0, 0.999);
  const k = -6.907755 / decayN; // exp(k·decayN) ≈ -60 dB at the tail's end
  let lp = 0;
  let energy = 0;
  for (let i = 0; i < decayN; i++) {
    const v = bipolar(rng) * Math.exp(k * i);
    lp = lp * damp + v * (1 - damp); // one-pole low-pass → HF damping
    ir[pre + i] = lp;
    energy += lp * lp;
  }
  const norm = energy > 0 ? 1 / Math.sqrt(energy) : 1;
  for (let i = 0; i < ir.length; i++) ir[i] *= norm;
  return ir;
}

/**
 * Convolution reverb. Returns a buffer extended by the IR tail (channel count
 * preserved); the input is not mutated. Note: convolution is O(n · irLength).
 */
export function convolutionReverb(d: AudioData, opts: ConvolutionReverbOptions = {}): AudioData {
  if (frameCount(d) === 0) return cloneAudioData(d);
  const impulse =
    opts.impulse ??
    buildImpulse(d.sampleRate, opts.decaySeconds ?? 0.8, opts.preDelayMs ?? 0, opts.damping ?? 0.3, opts.seed ?? 1);
  return convolve(d, impulse, clamp(opts.mix ?? 0.3, 0, 1));
}
