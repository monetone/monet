// ─────────────────────────────────────────────────────────────
// engine/dsp/sidechain-compress — sidechain (keyed) compressor
// ─────────────────────────────────────────────────────────────
// A compressor whose detector listens to a separate KEY signal instead of the
// target itself — the classic "pumping" effect (a kick drum ducks the bass, a
// voice ducks the music). Unlike the Auto-Ducker (a binary dip to a fixed level
// while the key is present), this applies a continuous compression curve: the
// more the key exceeds the threshold, the more the target is pulled down, scaled
// by `ratio`, with a soft knee, attack/release ballistics and make-up gain.
//
// Pure `(target, key, opts) => AudioData`; neither input is mutated.

import { cloneAudioData } from "../audio/buffer";
import { dbToGain, gainToDb } from "../audio/db";
import { channelCount, frameCount, type AudioData } from "../audio/types";
import { keyEnvelope, poleCoef } from "./sidechain-common";

export interface SidechainCompressOptions {
  /** Key level above which the target is compressed, dBFS (default −24). */
  thresholdDb?: number;
  /** Compression ratio (≥ 1; default 4). At 4:1 the target drops 3 dB per 4 dB the key is over. */
  ratio?: number;
  /** Soft-knee width around the threshold, dB (default 6). 0 = hard knee. */
  kneeDb?: number;
  /** Gain-reduction onset time, ms (default 10). */
  attackMs?: number;
  /** Gain-recovery time, ms (default 150). */
  releaseMs?: number;
  /** Make-up gain applied to the whole target, dB (default 0). */
  makeupDb?: number;
}

/** Static gain reduction (≥ 0 dB) for a key level `levelDb`, with a soft knee. */
function gainReductionDb(levelDb: number, thresholdDb: number, ratio: number, kneeDb: number): number {
  const x = levelDb - thresholdDb;
  const slope = 1 - 1 / ratio;
  if (kneeDb > 0 && x > -kneeDb / 2 && x < kneeDb / 2) {
    const t = x + kneeDb / 2; // 0 … kneeDb across the knee
    return (slope * (t * t)) / (2 * kneeDb);
  }
  return x >= kneeDb / 2 ? slope * x : 0;
}

/**
 * Compress `target` using `key` as the detector. The result keeps the target's
 * channel + frame count; the key is read up to its own length (silence beyond
 * it applies no reduction).
 */
export function sidechainCompress(target: AudioData, key: AudioData, opts: SidechainCompressOptions = {}): AudioData {
  const ch = channelCount(target);
  const n = frameCount(target);
  const out = cloneAudioData(target);
  if (ch === 0 || n === 0) return out;

  const sr = target.sampleRate;
  const threshold = opts.thresholdDb ?? -24;
  const ratio = Math.max(1, opts.ratio ?? 4);
  const knee = Math.max(0, opts.kneeDb ?? 6);
  const aCoef = poleCoef(opts.attackMs ?? 10, sr);
  const rCoef = poleCoef(opts.releaseMs ?? 150, sr);
  const makeup = dbToGain(opts.makeupDb ?? 0);

  const det = keyEnvelope(key, n, sr); // linear key level
  let grDb = 0; // smoothed gain reduction, dB (≥ 0)
  for (let i = 0; i < n; i++) {
    const levelDb = det[i] > 1e-9 ? gainToDb(det[i]) : -120;
    const targetGr = gainReductionDb(levelDb, threshold, ratio, knee);
    // Fast attack while reduction is increasing, slower release while it backs off.
    grDb = targetGr > grDb ? aCoef * grDb + (1 - aCoef) * targetGr : rCoef * grDb + (1 - rCoef) * targetGr;
    const g = dbToGain(-grDb) * makeup;
    for (let c = 0; c < ch; c++) out.channels[c][i] *= g;
  }
  return out;
}
