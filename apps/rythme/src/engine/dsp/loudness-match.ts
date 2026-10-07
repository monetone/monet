// ─────────────────────────────────────────────────────────────
// engine/dsp/loudness-match — Adobe Audition–style Match Loudness
// ─────────────────────────────────────────────────────────────
// Normalise a signal's INTEGRATED loudness (ITU-R BS.1770 / EBU R128) to a
// target in LUFS — the "Match Loudness" workflow used to hit streaming and
// broadcast targets (-14 / -16 / -23 LUFS). Because loudness is just a
// log-of-mean-square measure, a linear gain shifts LUFS by exactly the same
// number of dB, so we measure once and apply (target − measured) dB. An
// optional peak ceiling caps the result with the look-ahead Hard Limiter so the
// gain never clips. Distinct from RMS normalize — loudness is K-weighted + gated.
//
// Pure `(AudioData, opts) => AudioData`; the input is never mutated.

import { measureLoudness } from "../analysis/loudness";
import { dbToGain } from "../audio/db";
import { cloneAudioData } from "../audio/buffer";
import type { AudioData } from "../audio/types";
import { applyGainDb } from "./gain";
import { hardLimiter } from "./limiter";
import { peakAmplitude } from "./normalize";

export interface MatchLoudnessOptions {
  /** Target integrated loudness in LUFS (default -16, the common podcast target). */
  targetLufs?: number;
  /** Optional output sample-peak ceiling in dBFS; limits the result if the gain would exceed it. */
  peakCeilingDb?: number;
}

/**
 * Match the integrated loudness to `targetLufs`. Silent or too-short input
 * (loudness = -Infinity) is returned unchanged. With `peakCeilingDb`, the
 * output peak is held under the ceiling by the Hard Limiter.
 */
export function matchLoudness(d: AudioData, opts: MatchLoudnessOptions = {}): AudioData {
  const target = opts.targetLufs ?? -16;
  const integrated = measureLoudness(d).integrated;
  if (!Number.isFinite(integrated)) return cloneAudioData(d);

  let out = applyGainDb(d, target - integrated);
  if (opts.peakCeilingDb != null && peakAmplitude(out) > dbToGain(opts.peakCeilingDb)) {
    out = hardLimiter(out, { ceilingDb: opts.peakCeilingDb, inputBoostDb: 0, lookAheadMs: 2 });
  }
  return out;
}
