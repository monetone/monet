// ─────────────────────────────────────────────────────────────
// engine/dsp/sidechain-common — shared sidechain (key) detection
// ─────────────────────────────────────────────────────────────
// The level follower shared by the two-input (sidechain) processors — the
// Auto-Ducker and the Sidechain Compressor. Both watch a KEY signal's level and
// use it to drive the gain of a separate TARGET; only what they do with that
// level (binary duck vs. a compression curve) differs.

import type { AudioData } from "../audio/types";

/** One-pole coefficient for a time constant of `ms` at `sampleRate`. */
export function poleCoef(ms: number, sampleRate: number): number {
  return Math.exp(-1 / (Math.max(1e-3, ms / 1000) * sampleRate));
}

export interface KeyEnvelopeOptions {
  /** Detector attack time (how fast the level rises), ms. Default 5. */
  attackMs?: number;
  /** Detector release time (how fast the level falls), ms. Default 50. */
  releaseMs?: number;
}

/**
 * Fast-attack / slow-release peak follower of a `key` signal, sampled on the
 * target's frame grid (`frames` long). Each frame tracks the maximum |sample|
 * across the key's channels; frames past the key's own length read silence (0).
 * Returns the linear level envelope — the input is not mutated.
 */
export function keyEnvelope(key: AudioData, frames: number, sampleRate: number, opts: KeyEnvelopeOptions = {}): Float64Array {
  const env = new Float64Array(frames);
  const atk = poleCoef(opts.attackMs ?? 5, sampleRate);
  const rel = poleCoef(opts.releaseMs ?? 50, sampleRate);
  const ch = key.channels;
  const keyLen = ch.length ? ch[0].length : 0;
  let det = 0;
  for (let i = 0; i < frames; i++) {
    let k = 0;
    if (i < keyLen) {
      for (let c = 0; c < ch.length; c++) {
        const a = Math.abs(ch[c][i]);
        if (a > k) k = a;
      }
    }
    det = k > det ? atk * det + (1 - atk) * k : rel * det + (1 - rel) * k;
    env[i] = det;
  }
  return env;
}
