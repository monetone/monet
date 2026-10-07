// ─────────────────────────────────────────────────────────────
// engine/generate/noise — white / pink / brown noise
// ─────────────────────────────────────────────────────────────

import { createAudioData } from "../audio/buffer";
import type { AudioData } from "../audio/types";
import { DEFAULT_SAMPLE_RATE } from "../model/factory";
import { bipolar, mulberry32 } from "./rng";

export interface NoiseOptions {
  sampleRate?: number;
  amplitude?: number;
  channels?: number;
  /** Seed for reproducible output (default 1). */
  seed?: number;
}

/** Flat-spectrum white noise. */
export function whiteNoise(seconds: number, opts: NoiseOptions = {}): AudioData {
  const sampleRate = opts.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const amp = opts.amplitude ?? 0.5;
  const channels = opts.channels ?? 1;
  const rand = mulberry32(opts.seed ?? 1);
  const n = Math.max(0, Math.round(seconds * sampleRate));
  const d = createAudioData(channels, n, sampleRate);
  for (let c = 0; c < channels; c++) {
    const ch = d.channels[c];
    for (let i = 0; i < n; i++) ch[i] = amp * bipolar(rand);
  }
  return d;
}

/** Pink noise (-3 dB/oct) via Paul Kellet's economical filter. */
export function pinkNoise(seconds: number, opts: NoiseOptions = {}): AudioData {
  const sampleRate = opts.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const amp = opts.amplitude ?? 0.5;
  const channels = opts.channels ?? 1;
  const rand = mulberry32(opts.seed ?? 1);
  const n = Math.max(0, Math.round(seconds * sampleRate));
  const d = createAudioData(channels, n, sampleRate);
  for (let c = 0; c < channels; c++) {
    const ch = d.channels[c];
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < n; i++) {
      const w = bipolar(rand);
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
      ch[i] = amp * pink * 0.11; // scale into range
    }
  }
  return d;
}

/** Brown / red noise (-6 dB/oct) via integration of white noise. */
export function brownNoise(seconds: number, opts: NoiseOptions = {}): AudioData {
  const sampleRate = opts.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const amp = opts.amplitude ?? 0.5;
  const channels = opts.channels ?? 1;
  const rand = mulberry32(opts.seed ?? 1);
  const n = Math.max(0, Math.round(seconds * sampleRate));
  const d = createAudioData(channels, n, sampleRate);
  for (let c = 0; c < channels; c++) {
    const ch = d.channels[c];
    let last = 0;
    for (let i = 0; i < n; i++) {
      last = (last + 0.02 * bipolar(rand)) / 1.02;
      ch[i] = amp * last * 3.5;
    }
  }
  return d;
}
