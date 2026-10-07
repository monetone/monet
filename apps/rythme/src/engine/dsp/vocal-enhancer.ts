// ─────────────────────────────────────────────────────────────
// engine/dsp/vocal-enhancer — Adobe Audition–style Vocal Enhancer
// ─────────────────────────────────────────────────────────────
// One-button voice optimisation. Like Audition's Vocal Enhancer, the Male and
// Female modes clean up a voice-over — high-pass away mic rumble/handling noise,
// de-ess the sibilance, lift the presence band, and compress for an even "radio"
// level — with the bands tuned to each voice type. Music mode is gentler: just a
// little sub-rumble trim, a touch of clarity, and light compression. It's a
// preset chain over the engine's existing DSP, so each stage is already tested
// in isolation. Pure `(AudioData, opts) => AudioData`; never mutates its input.

import { cloneAudioData } from "../audio/buffer";
import { frameCount, type AudioData } from "../audio/types";
import { applyBiquad } from "./biquad";
import { deEss } from "./de-esser";
import { compress, type CompressorOptions } from "./dynamics";
import { highpass } from "./filter";

export type VocalEnhancerMode = "male" | "female" | "music";

export interface VocalEnhancerOptions {
  mode?: VocalEnhancerMode;
}

interface VocalPreset {
  /** Rumble / handling-noise high-pass corner (Hz). */
  highpassHz: number;
  /** De-ess centre frequency (Hz); 0 disables de-essing. */
  essHz: number;
  /** Presence band centre (Hz) + boost (dB) + Q. */
  presenceHz: number;
  presenceDb: number;
  presenceQ: number;
  /** Leveling compressor. */
  comp: CompressorOptions;
}

const PRESETS: Record<VocalEnhancerMode, VocalPreset> = {
  male: {
    highpassHz: 90,
    essHz: 6500,
    presenceHz: 3500,
    presenceDb: 3,
    presenceQ: 2,
    comp: { thresholdDb: -18, ratio: 2.5, attackMs: 8, releaseMs: 150, makeupDb: 1.5 },
  },
  female: {
    highpassHz: 110,
    essHz: 7500,
    presenceHz: 5000,
    presenceDb: 3,
    presenceQ: 2,
    comp: { thresholdDb: -18, ratio: 2.5, attackMs: 8, releaseMs: 150, makeupDb: 1.5 },
  },
  music: {
    highpassHz: 40,
    essHz: 0,
    presenceHz: 3000,
    presenceDb: 1.5,
    presenceQ: 1.5,
    comp: { thresholdDb: -20, ratio: 1.5, attackMs: 15, releaseMs: 200, makeupDb: 0.5 },
  },
};

/**
 * Enhance a voice (or, in Music mode, a mix) with a tuned chain of high-pass,
 * de-ess, presence EQ and compression. Output keeps the input's shape; the
 * input is not mutated.
 */
export function vocalEnhance(d: AudioData, opts: VocalEnhancerOptions = {}): AudioData {
  if (frameCount(d) === 0) return cloneAudioData(d);
  const p = PRESETS[opts.mode ?? "male"] ?? PRESETS.male;

  let out = highpass(d, p.highpassHz, Math.SQRT1_2, 2);
  if (p.essHz > 0) out = deEss(out, { centerFreq: p.essHz, thresholdDb: -28 });
  out = applyBiquad(out, { type: "peaking", freq: p.presenceHz, q: p.presenceQ, gainDb: p.presenceDb });
  out = compress(out, p.comp);
  return out;
}
