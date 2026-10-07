// ─────────────────────────────────────────────────────────────
// engine/dsp/sidechain-gate — sidechain (keyed) gate
// ─────────────────────────────────────────────────────────────
// A noise gate whose detector listens to a separate KEY signal: the target is
// audible only while the key is present and is attenuated when the key is gone —
// the INVERSE of the Auto-Ducker (which dips the target when the key is present).
// Used to key one part by another's rhythm (a "trance gate"), gate a reverb tail
// by the dry signal, or tighten a track to a trigger.
//
// While the key level is over the threshold (plus a hold tail) the gate opens to
// unity; otherwise it closes to `rangeDb` of attenuation, with a fast attack as
// it opens and a slower release as it closes. Pure; neither input is mutated.

import { cloneAudioData } from "../audio/buffer";
import { dbToGain } from "../audio/db";
import { channelCount, frameCount, type AudioData } from "../audio/types";
import { keyEnvelope, poleCoef } from "./sidechain-common";

export interface SidechainGateOptions {
  /** Key level above which the gate opens, dBFS (default −30). */
  thresholdDb?: number;
  /** Attenuation applied to the target while the gate is closed, dB (≤ 0; default −60). */
  rangeDb?: number;
  /** Time to open once the key crosses the threshold, ms (default 5). */
  attackMs?: number;
  /** Keep the gate open this long after the key drops below threshold, ms (default 50). */
  holdMs?: number;
  /** Time to close after the hold, ms (default 150). */
  releaseMs?: number;
}

/**
 * Gate `target` by the level of `key`. The result keeps the target's channel and
 * frame count; the key is read up to its own length (silence beyond it keeps the
 * gate closed). Both inputs are left unmodified.
 */
export function sidechainGate(target: AudioData, key: AudioData, opts: SidechainGateOptions = {}): AudioData {
  const ch = channelCount(target);
  const n = frameCount(target);
  const out = cloneAudioData(target);
  if (ch === 0 || n === 0) return out;

  const sr = target.sampleRate;
  const threshold = dbToGain(opts.thresholdDb ?? -30);
  const floor = dbToGain(Math.min(0, opts.rangeDb ?? -60));
  const aCoef = poleCoef(opts.attackMs ?? 5, sr);
  const rCoef = poleCoef(opts.releaseMs ?? 150, sr);
  const holdSamples = Math.max(0, Math.round(((opts.holdMs ?? 50) / 1000) * sr));

  const det = keyEnvelope(key, n, sr); // fast-attack / slow-release key follower
  let hold = 0;
  let gain = floor; // start closed
  for (let i = 0; i < n; i++) {
    if (det[i] > threshold) hold = holdSamples;
    else if (hold > 0) hold--;
    const open = det[i] > threshold || hold > 0;

    const desired = open ? 1 : floor;
    // Fast attack while opening (gain rising), slower release while closing.
    gain = desired > gain ? aCoef * gain + (1 - aCoef) * desired : rCoef * gain + (1 - rCoef) * desired;

    for (let c = 0; c < ch; c++) out.channels[c][i] *= gain;
  }
  return out;
}
