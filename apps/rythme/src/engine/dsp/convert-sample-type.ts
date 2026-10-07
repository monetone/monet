// ─────────────────────────────────────────────────────────────
// engine/dsp/convert-sample-type — Adobe Audition–style Convert Sample Type
// ─────────────────────────────────────────────────────────────
// Audition's Edit ▸ Convert Sample Type changes a waveform's channel count and
// bit depth (and, at the session level, its sample rate). This covers the two
// per-waveform conversions:
//   • Channels — stereo→mono mixes the two sides by Left Mix / Right Mix (50/50
//     by default); mono→stereo duplicates the channel. Unlike the Channel Mixer
//     (a 2×2 matrix that keeps two channels) this changes the channel *count*.
//   • Bit depth — re-quantize to 2^bitDepth levels. Truncating outright adds
//     "crackly" quantization distortion to quiet passages, so we optionally add
//     triangular (TPDF) dither first: a little noise that decorrelates the error,
//     trading distortion for a small, benign hiss — exactly Audition's dither.
// (Sample-rate conversion is a session property — clips are resampled to the
// project rate on import — so it is not a per-clip effect here.)
// Pure `(AudioData, opts) => AudioData`; the input is never mutated.

import { cloneAudioData, createAudioData, mixToMono } from "../audio/buffer";
import { clampSample } from "../audio/db";
import { frameCount, channelCount, type AudioData } from "../audio/types";
import { mulberry32 } from "../generate/rng";

export interface ConvertSampleTypeOptions {
  /** Target channel count, 1 (mono) or 2 (stereo). Default = keep the source count. */
  channels?: 1 | 2;
  /** Stereo→mono: fraction of the left channel in the mono mix (0…1). Default 0.5. */
  leftMix?: number;
  /** Stereo→mono: fraction of the right channel in the mono mix (0…1). Default 0.5. */
  rightMix?: number;
  /** Target bit depth (e.g. 8, 12, 16, 24). ≥32 or unset = no re-quantization. */
  bitDepth?: number;
  /** Add triangular (TPDF) dither before quantizing to a lower bit depth. Default false. */
  dither?: boolean;
  /** RNG seed for the dither noise (deterministic). Default 1. */
  seed?: number;
}

/** Convert channel count: stereo→mono by mix, mono→stereo by duplication. */
function convertChannels(d: AudioData, target: 1 | 2, leftMix: number, rightMix: number): AudioData {
  const src = channelCount(d);
  if (src === target) return cloneAudioData(d);
  const n = frameCount(d);

  if (target === 1) {
    if (src === 2) {
      const out = createAudioData(1, n, d.sampleRate);
      const L = d.channels[0];
      const R = d.channels[1];
      const m = out.channels[0];
      for (let i = 0; i < n; i++) m[i] = L[i] * leftMix + R[i] * rightMix;
      return out;
    }
    return mixToMono(d); // any other count → equal-weight down-mix
  }

  // → stereo: duplicate channel 0 (a mono source) onto both sides.
  const out = createAudioData(2, n, d.sampleRate);
  const s = d.channels[0] ?? new Float32Array(n);
  out.channels[0].set(s);
  out.channels[1].set(s);
  return out;
}

/** Re-quantize to `bitDepth` levels, optionally TPDF-dithered. Mutates `out` in place. */
function quantize(out: AudioData, bitDepth: number, dither: boolean, seed: number): void {
  const levels = Math.pow(2, bitDepth - 1); // signed full-scale steps
  const step = 1 / levels;
  const rng = dither ? mulberry32(seed) : null;
  for (const ch of out.channels) {
    for (let i = 0; i < ch.length; i++) {
      let v = ch[i];
      if (rng) v += (rng() + rng() - 1) * step; // triangular dither, ±1 step peak
      ch[i] = clampSample(Math.round(v / step) * step);
    }
  }
}

/**
 * Convert a buffer's channel count and/or bit depth. Returns a new buffer; the
 * input is never mutated. With no channel change and bitDepth ≥ 32 it is a copy.
 */
export function convertSampleType(d: AudioData, opts: ConvertSampleTypeOptions = {}): AudioData {
  const target = opts.channels ?? (channelCount(d) as 1 | 2);
  const out = target === channelCount(d)
    ? cloneAudioData(d)
    : convertChannels(d, target, opts.leftMix ?? 0.5, opts.rightMix ?? 0.5);

  const bitDepth = opts.bitDepth ?? 32;
  if (bitDepth >= 1 && bitDepth < 32 && frameCount(out) > 0) {
    quantize(out, bitDepth, opts.dither ?? false, opts.seed ?? 1);
  }
  return out;
}
