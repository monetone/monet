// ─────────────────────────────────────────────────────────────
// engine/dsp/sidechain-duck — Adobe Audition–style Auto-Ducking
// ─────────────────────────────────────────────────────────────
// Audition's Essential Sound ▸ Ducking: automatically dip a background track
// (music, ambience) whenever a key track (dialogue, voice-over) is present, so
// the voice always sits on top. The KEY signal drives the gain of the TARGET:
//
//   1. Follow the key's level with a fast-attack / slow-release peak follower.
//   2. While that level is over the threshold (plus a hold tail after it drops),
//      pull the target down by `amountDb`; otherwise leave it at unity.
//   3. Move toward that target gain with a smooth attack (ducking down) /
//      release (coming back up) so the dips fade in and out without clicks.
//
// This is a two-input processor — distinct from the single-band Compressor and
// the Speech Volume Leveler (both self-driven). Pure: neither input is mutated.

import { cloneAudioData } from "../audio/buffer";
import { dbToGain } from "../audio/db";
import { channelCount, frameCount, type AudioData } from "../audio/types";
import { keyEnvelope, poleCoef } from "./sidechain-common";

export interface SidechainDuckOptions {
  /** Attenuation applied to the target while the key is active, dB (≤ 0; default −12). */
  amountDb?: number;
  /** Key level above which ducking engages, dBFS (default −30). */
  thresholdDb?: number;
  /** Time to reach full attenuation once the key crosses the threshold, ms (default 60). */
  attackMs?: number;
  /** Time to recover to unity after the key falls silent, ms (default 400). */
  releaseMs?: number;
  /** Keep ducking this long after the key drops below threshold, ms (default 200). */
  holdMs?: number;
}

/**
 * Duck `target` by the level of `key`. The result has the target's channel and
 * frame count; the key is read up to its own length (silence beyond it never
 * ducks). Both inputs are left unmodified.
 */
export function sidechainDuck(target: AudioData, key: AudioData, opts: SidechainDuckOptions = {}): AudioData {
  const ch = channelCount(target);
  const n = frameCount(target);
  const out = cloneAudioData(target);
  if (ch === 0 || n === 0) return out;

  const sr = target.sampleRate;
  const duckGain = dbToGain(Math.min(0, opts.amountDb ?? -12));
  const threshold = dbToGain(opts.thresholdDb ?? -30);
  const aCoef = poleCoef(opts.attackMs ?? 60, sr);
  const rCoef = poleCoef(opts.releaseMs ?? 400, sr);
  const holdSamples = Math.max(0, Math.round(((opts.holdMs ?? 200) / 1000) * sr));

  const det = keyEnvelope(key, n, sr); // fast-attack / slow-release key follower
  let hold = 0;
  let gain = 1;
  for (let i = 0; i < n; i++) {
    if (det[i] > threshold) hold = holdSamples;
    else if (hold > 0) hold--;
    const engaged = det[i] > threshold || hold > 0;

    const desired = engaged ? duckGain : 1;
    // Attack while ducking down, release while coming back up.
    gain = desired < gain ? aCoef * gain + (1 - aCoef) * desired : rCoef * gain + (1 - rCoef) * desired;

    for (let c = 0; c < ch; c++) out.channels[c][i] *= gain;
  }
  return out;
}
