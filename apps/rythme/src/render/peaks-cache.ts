// ─────────────────────────────────────────────────────────────
// render/peaks-cache — memoized waveform peak overviews
// ─────────────────────────────────────────────────────────────
// Drawing a clip recomputes its min/max peak buckets only when the clip's
// visible region or the requested pixel resolution actually changes. A clip's
// source buffer is identified by reference, so undo/redo (which swaps buffers)
// invalidates the cache naturally.

import { Analysis, mixToMono, sliceFrames, type Clip } from "../engine";

type ChannelPeaks = Analysis.ChannelPeaks;

interface Entry {
  bufferRef: object;
  inPoint: number;
  duration: number;
  buckets: number;
  peaks: ChannelPeaks;
}

const cache = new WeakMap<Clip, Entry>();

/** Mono peak overview of a clip's visible region at `buckets` resolution. */
export function getClipPeaks(clip: Clip, buckets: number): ChannelPeaks {
  const b = Math.max(1, Math.floor(buckets));
  const prev = cache.get(clip);
  if (
    prev &&
    prev.bufferRef === clip.buffer &&
    prev.inPoint === clip.inPoint &&
    prev.duration === clip.duration &&
    prev.buckets === b
  ) {
    return prev.peaks;
  }
  const sr = clip.buffer.sampleRate;
  const start = Math.round(clip.inPoint * sr);
  const end = Math.round((clip.inPoint + clip.duration) * sr);
  const region = sliceFrames(clip.buffer, start, end);
  const mono = mixToMono(region).channels[0];
  const peaks = Analysis.channelPeaks(mono, b);
  cache.set(clip, { bufferRef: clip.buffer, inPoint: clip.inPoint, duration: clip.duration, buckets: b, peaks });
  return peaks;
}
