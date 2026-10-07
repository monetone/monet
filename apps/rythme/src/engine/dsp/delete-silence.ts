// ─────────────────────────────────────────────────────────────
// engine/dsp/delete-silence — Adobe Audition–style Delete Silence
// ─────────────────────────────────────────────────────────────
// Audition's Delete Silence: detect the gaps between words/phrases and remove
// (or shorten) them, tightening a narration without touching the foreground
// audio. Silence is "signal below `thresholdDb` for more than `minSilenceMs`";
// every qualifying gap is trimmed down to at most `keepMs` of silence (0 removes
// it entirely). The buffer therefore gets *shorter*. Pure `(AudioData, opts) =>
// AudioData`; the input is never mutated, and all channels are cut at the same
// time positions so a stereo image stays aligned.

import { detectSilence } from "../analysis/detect";
import { cloneAudioData, concat, sliceFrames } from "../audio/buffer";
import { frameCount, type AudioData } from "../audio/types";

export interface DeleteSilenceOptions {
  /** "Signal is below" — the level at or under which audio counts as silence (dBFS). Default −50. */
  thresholdDb?: number;
  /** "For more than" — only gaps at least this long are trimmed (ms). Default 200. */
  minSilenceMs?: number;
  /** Silence left in each trimmed gap, in ms (0 = remove entirely). Default 100. */
  keepMs?: number;
}

/**
 * Remove or shorten silent gaps. Returns a new, shorter buffer; with no
 * qualifying silence it is an exact copy of the input.
 */
export function deleteSilence(d: AudioData, opts: DeleteSilenceOptions = {}): AudioData {
  const n = frameCount(d);
  if (n === 0) return cloneAudioData(d);

  const sr = d.sampleRate;
  const thresholdDb = opts.thresholdDb ?? -50;
  const minSilenceMs = opts.minSilenceMs ?? 200;
  const keep = Math.max(0, Math.round(((opts.keepMs ?? 100) / 1000) * sr));

  const regions = detectSilence(d, thresholdDb, minSilenceMs / 1000);
  if (regions.length === 0) return cloneAudioData(d);

  const segments: AudioData[] = [];
  let cursor = 0;
  for (const r of regions) {
    const start = Math.min(n, Math.max(0, Math.round(r.start * sr)));
    const end = Math.min(n, Math.max(start, Math.round(r.end * sr)));
    if (start > cursor) segments.push(sliceFrames(d, cursor, start)); // the audio before the gap
    const kept = Math.min(end - start, keep); // trim the gap to `keep` samples of silence
    if (kept > 0) segments.push(sliceFrames(d, start, start + kept));
    cursor = end;
  }
  if (cursor < n) segments.push(sliceFrames(d, cursor, n)); // trailing audio

  if (segments.length === 0) return sliceFrames(d, 0, 0); // everything was silence (keep = 0)
  return concat(...segments);
}
