// ─────────────────────────────────────────────────────────────
// engine/analysis/peaks — waveform min/max peak data for rendering
// ─────────────────────────────────────────────────────────────
// To draw a waveform we don't plot every sample — we reduce each horizontal
// pixel column to the min & max sample it spans. This is the classic two-value
// "peak" overview that DAWs cache per zoom level.

import type { AudioData } from "../audio/types";

export interface ChannelPeaks {
  /** Minimum sample per bucket (range [-1, 1]). */
  min: Float32Array;
  /** Maximum sample per bucket. */
  max: Float32Array;
}

/**
 * Reduce one channel to `buckets` min/max pairs. With more buckets than samples
 * the extra buckets simply repeat the nearest sample.
 */
export function channelPeaks(ch: Float32Array, buckets: number): ChannelPeaks {
  const n = ch.length;
  const min = new Float32Array(buckets);
  const max = new Float32Array(buckets);
  if (n === 0) return { min, max };
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor((b * n) / buckets);
    const end = Math.max(start + 1, Math.floor(((b + 1) * n) / buckets));
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = start; i < end && i < n; i++) {
      const v = ch[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    min[b] = lo === Infinity ? 0 : lo;
    max[b] = hi === -Infinity ? 0 : hi;
  }
  return { min, max };
}

/** Peak overview for every channel of a buffer. */
export function computePeaks(d: AudioData, buckets: number): ChannelPeaks[] {
  return d.channels.map((ch) => channelPeaks(ch, buckets));
}
