// ─────────────────────────────────────────────────────────────
// query.ts — pure, read-only queries over the generic timeline model.
// Generic over `C extends TimelineSpan` — queries only read id/start/duration,
// so they work for any timeline clip (frames or seconds). No mutation.
// ─────────────────────────────────────────────────────────────

import type { Id, TimelineSequence, TimelineSpan, TimelineTrack } from "./model";

/** Whether `t` falls within the clip's [start, start+duration) span (half-open). */
export function clipCovers(clip: TimelineSpan, t: number): boolean {
  return t >= clip.start && t < clip.start + clip.duration;
}

/** The clip on `track` covering `t`, if any. */
export function clipAt<C extends TimelineSpan>(track: TimelineTrack<C>, t: number): C | null {
  return track.clips.find((c) => clipCovers(c, t)) ?? null;
}

export interface ClipHit<C extends TimelineSpan> {
  track: TimelineTrack<C>;
  clip: C;
}

/** Locate a clip (and its track) by id across a sequence. */
export function findClip<C extends TimelineSpan>(seq: TimelineSequence<C>, clipId: Id): ClipHit<C> | null {
  for (const track of seq.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { track, clip };
  }
  return null;
}

export function findTrack<C extends TimelineSpan>(seq: TimelineSequence<C>, trackId: Id): TimelineTrack<C> | null {
  return seq.tracks.find((t) => t.id === trackId) ?? null;
}

/** Clips on a track overlapping [start, start+duration), excluding `excludeId`. */
export function overlapping<C extends TimelineSpan>(track: TimelineTrack<C>, start: number, duration: number, excludeId?: Id): C[] {
  const end = start + duration;
  return track.clips.filter((c) => c.id !== excludeId && c.start < end && c.start + c.duration > start);
}

/** Whether [start, start+duration) is free on `track` (ignoring `excludeId`). */
export function isRangeFree<C extends TimelineSpan>(track: TimelineTrack<C>, start: number, duration: number, excludeId?: Id): boolean {
  return overlapping(track, start, duration, excludeId).length === 0;
}

/** Clips on a track sorted by start (a copy). */
export function clipsByStart<C extends TimelineSpan>(track: TimelineTrack<C>): C[] {
  return [...track.clips].sort((a, b) => a.start - b.start);
}

/** The largest clip end across all tracks (content extent). */
export function contentEnd<C extends TimelineSpan>(seq: TimelineSequence<C>): number {
  let end = 0;
  for (const track of seq.tracks) {
    for (const clip of track.clips) {
      const e = clip.start + clip.duration;
      if (e > end) end = e;
    }
  }
  return end;
}

/** The next clip edge (start or end) strictly after `t` across all tracks. */
export function nextEdge<C extends TimelineSpan>(seq: TimelineSequence<C>, t: number): number {
  let best = Infinity;
  for (const track of seq.tracks) {
    for (const c of track.clips) {
      if (c.start > t && c.start < best) best = c.start;
      const end = c.start + c.duration;
      if (end > t && end < best) best = end;
    }
  }
  return Number.isFinite(best) ? best : t;
}

/** The previous clip edge (start or end) strictly before `t`. */
export function prevEdge<C extends TimelineSpan>(seq: TimelineSequence<C>, t: number): number {
  let best = -Infinity;
  for (const track of seq.tracks) {
    for (const c of track.clips) {
      if (c.start < t && c.start > best) best = c.start;
      const end = c.start + c.duration;
      if (end < t && end > best) best = end;
    }
  }
  return Number.isFinite(best) ? best : t;
}

/**
 * Snap `t` to the nearest clip edge / origin within `threshold`. `extra` adds
 * candidate positions (e.g. the playhead); `excludeId` skips a dragged clip's
 * own edges.
 */
export function snapTime<C extends TimelineSpan>(
  seq: TimelineSequence<C>,
  t: number,
  threshold: number,
  excludeId?: Id,
  extra: number[] = [],
): number {
  let best = t;
  let bestDist = threshold;
  const consider = (edge: number) => {
    const d = Math.abs(edge - t);
    if (d <= bestDist) {
      bestDist = d;
      best = edge;
    }
  };
  consider(0);
  for (const e of extra) consider(e);
  for (const track of seq.tracks) {
    for (const c of track.clips) {
      if (c.id === excludeId) continue;
      consider(c.start);
      consider(c.start + c.duration);
    }
  }
  return best;
}
