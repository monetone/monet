// ─────────────────────────────────────────────────────────────
// frame-source.ts — the decoded-frame cache the compositor reads from.
//
// The decode pipeline (media/decoder + playback/player, WebCodecs) populates
// this cache keyed by (mediaId, sourceFrame); the compositor pulls the nearest
// ready frame for each visible clip. Keeping the cache behind this tiny
// interface lets the synchronous compositor stay decoupled from the async
// decoders. Frames are straight-alpha RGBA8 at the media's native resolution.
// ─────────────────────────────────────────────────────────────

export interface DecodedFrame {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

type Key = string;
const cache = new Map<Key, DecodedFrame>();
const MAX_ENTRIES = 240;

function key(mediaId: string, sourceFrame: number): Key {
  return `${mediaId}@${sourceFrame}`;
}

/** Store a decoded frame for (mediaId, sourceFrame). */
export function putFrame(mediaId: string, sourceFrame: number, frame: DecodedFrame): void {
  if (cache.size >= MAX_ENTRIES) {
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  cache.set(key(mediaId, sourceFrame), frame);
}

/** Exact decoded frame, or null if not yet decoded. */
export function getFrame(mediaId: string, sourceFrame: number): DecodedFrame | null {
  return cache.get(key(mediaId, sourceFrame)) ?? null;
}

/**
 * The nearest cached frame within `tolerance` source frames — playback decodes
 * keyframe-aligned, so the compositor accepts a close-enough frame rather than
 * dropping to background while the exact frame is in flight.
 */
export function getNearestFrame(mediaId: string, sourceFrame: number, tolerance = 4): DecodedFrame | null {
  const exact = getFrame(mediaId, sourceFrame);
  if (exact) return exact;
  for (let d = 1; d <= tolerance; d++) {
    const before = getFrame(mediaId, sourceFrame - d);
    if (before) return before;
    const after = getFrame(mediaId, sourceFrame + d);
    if (after) return after;
  }
  return null;
}

/** Drop cached frames for a media item (on unload / replace). */
export function evictMedia(mediaId: string): void {
  for (const k of cache.keys()) {
    if (k.startsWith(`${mediaId}@`)) cache.delete(k);
  }
}

export function clearFrames(): void {
  cache.clear();
}
