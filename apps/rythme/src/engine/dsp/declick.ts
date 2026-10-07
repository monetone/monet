// ─────────────────────────────────────────────────────────────
// engine/dsp/declick — Adobe Audition–style DeClicker / Click Remover
// ─────────────────────────────────────────────────────────────
// Removes clicks and pops (vinyl crackle, wireless-mic ticks, mouth clicks).
// A click is a sample that jumps sharply away from where the waveform "should"
// be: the local-prediction residual |x[i] − (x[i−1]+x[i+1])/2| spikes. Samples
// whose residual clears an adaptive threshold (a multiple of the median
// residual, with an absolute floor) are flagged, grouped into short runs, and
// repaired by linear interpolation across the surrounding good samples. Like
// Audition's DeClicker, lower sensitivity/threshold detects more clicks.
// Pure `(AudioData, opts) => AudioData`; the input is never mutated.

import { cloneAudioData } from "../audio/buffer";
import { clamp } from "../audio/db";
import { type AudioData } from "../audio/types";

export interface DeClickerOptions {
  /** Detection aggressiveness — residual must exceed `sensitivity × median residual`. Lower = more clicks. */
  sensitivity?: number;
  /** Absolute residual floor below which nothing is flagged (protects clean tonal content). */
  threshold?: number;
  /** Longest run of consecutive flagged samples treated as a single click. */
  maxRunLength?: number;
}

/** Median of a copy of `arr` (does not mutate the input). */
function median(arr: Float64Array): number {
  if (arr.length === 0) return 0;
  const sorted = Float64Array.from(arr).sort();
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Detect and interpolate over clicks/pops. The output keeps the input's channel
 * and frame count; the input is not mutated.
 */
export function deClick(d: AudioData, opts: DeClickerOptions = {}): AudioData {
  const sensitivity = Math.max(0, opts.sensitivity ?? 5);
  const floor = Math.max(0, opts.threshold ?? 0.02);
  const maxRun = Math.max(1, Math.floor(opts.maxRunLength ?? 16));

  const out = cloneAudioData(d);
  for (const ch of out.channels) {
    const n = ch.length;
    if (n < 3) continue;

    // Local-prediction residual (|second difference| / 2).
    const residual = new Float64Array(n);
    for (let i = 1; i < n - 1; i++) residual[i] = Math.abs(ch[i] - (ch[i - 1] + ch[i + 1]) / 2);
    const detThresh = Math.max(floor, sensitivity * median(residual));

    let i = 1;
    while (i < n - 1) {
      if (residual[i] <= detThresh) {
        i++;
        continue;
      }
      // A flagged run [start, end], bounded by maxRun; anchors are the good
      // samples just outside it.
      const start = i;
      while (i < n - 1 && residual[i] > detThresh && i - start < maxRun) i++;
      const end = i - 1;
      const a = start - 1;
      const b = Math.min(n - 1, end + 1);
      const span = b - a;
      for (let j = start; j <= end; j++) {
        const t = clamp((j - a) / span, 0, 1);
        ch[j] = ch[a] * (1 - t) + ch[b] * t;
      }
    }
  }
  return out;
}
