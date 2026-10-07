// ─────────────────────────────────────────────────────────────
// engine/dsp/modulation — tremolo, chorus, flanger, vibrato
// ─────────────────────────────────────────────────────────────
// LFO-driven effects. Tremolo modulates amplitude; chorus/flanger/vibrato
// modulate a short delay line read with fractional (linearly interpolated)
// taps so the delay time can sweep smoothly.

import { cloneAudioData } from "../audio/buffer";
import { channelCount, frameCount, type AudioData } from "../audio/types";

export interface TremoloOptions {
  rateHz?: number;
  /** Depth 0…1 (1 = full amplitude swing). */
  depth?: number;
}

/** Amplitude modulation (tremolo). */
export function tremolo(d: AudioData, opts: TremoloOptions = {}): AudioData {
  const rate = opts.rateHz ?? 5;
  const depth = Math.min(1, Math.max(0, opts.depth ?? 0.6));
  const sr = d.sampleRate;
  const out = cloneAudioData(d);
  const n = frameCount(out);
  for (let i = 0; i < n; i++) {
    const lfo = 1 - depth * 0.5 * (1 - Math.cos((2 * Math.PI * rate * i) / sr));
    for (const ch of out.channels) ch[i] *= lfo;
  }
  return out;
}

/** Read a delay line at a fractional sample offset with linear interpolation. */
function fracTap(buf: Float32Array, writeIdx: number, delaySamples: number): number {
  const read = writeIdx - delaySamples;
  const i0 = Math.floor(read);
  const frac = read - i0;
  const a = buf[((i0 % buf.length) + buf.length) % buf.length];
  const b = buf[(((i0 + 1) % buf.length) + buf.length) % buf.length];
  return a * (1 - frac) + b * frac;
}

interface ModDelayOptions {
  rateHz: number;
  baseMs: number;
  depthMs: number;
  feedback: number;
  mix: number;
}

function modDelay(d: AudioData, o: ModDelayOptions): AudioData {
  const sr = d.sampleRate;
  const out = cloneAudioData(d);
  const ch = channelCount(out);
  const n = frameCount(out);
  const baseS = (o.baseMs / 1000) * sr;
  const depthS = (o.depthMs / 1000) * sr;
  const maxDelay = Math.ceil(baseS + depthS) + 4;
  for (let c = 0; c < ch; c++) {
    const src = d.channels[c];
    const dst = out.channels[c];
    const line = new Float32Array(maxDelay);
    let w = 0;
    const phase = (c * Math.PI) / 2; // spread channels
    for (let i = 0; i < n; i++) {
      const lfo = (1 - Math.cos((2 * Math.PI * o.rateHz * i) / sr + phase)) / 2; // 0..1
      const delaySamples = baseS + depthS * lfo;
      const delayed = fracTap(line, w, delaySamples);
      line[w] = src[i] + delayed * o.feedback;
      dst[i] = src[i] * (1 - o.mix) + delayed * o.mix;
      w = (w + 1) % maxDelay;
    }
  }
  return out;
}

export interface ChorusOptions {
  rateHz?: number;
  depthMs?: number;
  mix?: number;
}

/** Chorus: a slow, deep modulated delay with no feedback. */
export function chorus(d: AudioData, opts: ChorusOptions = {}): AudioData {
  return modDelay(d, {
    rateHz: opts.rateHz ?? 0.8,
    baseMs: 22,
    depthMs: opts.depthMs ?? 6,
    feedback: 0,
    mix: opts.mix ?? 0.5,
  });
}

export interface FlangerOptions {
  rateHz?: number;
  depthMs?: number;
  feedback?: number;
  mix?: number;
}

/** Flanger: a short modulated delay with feedback (jet-sweep comb). */
export function flanger(d: AudioData, opts: FlangerOptions = {}): AudioData {
  return modDelay(d, {
    rateHz: opts.rateHz ?? 0.25,
    baseMs: 1,
    depthMs: opts.depthMs ?? 3,
    feedback: Math.min(0.95, opts.feedback ?? 0.5),
    mix: opts.mix ?? 0.5,
  });
}

export interface VibratoOptions {
  rateHz?: number;
  depthMs?: number;
}

/** Vibrato: pure pitch modulation (100% wet modulated delay, no dry). */
export function vibrato(d: AudioData, opts: VibratoOptions = {}): AudioData {
  return modDelay(d, {
    rateHz: opts.rateHz ?? 5,
    baseMs: 5,
    depthMs: opts.depthMs ?? 2,
    feedback: 0,
    mix: 1,
  });
}
