// ─────────────────────────────────────────────────────────────
// ops.ts — generic, pure timeline editing operations.
//
// Every function mutates the passed-in track/sequence in place (callers run
// them inside a clone-on-write store transaction). Generic over the app's clip
// type `C extends TimelineClip`; the app's extra clip payload is preserved
// across splits/duplications via structuredClone. Time values are plain numbers
// (frames or seconds). This is the editorial core shared by all Monet NLEs;
// domain-specific behavior (clearing video transitions on a cut, audio fades,
// track-kind rules) is layered on top by each app.
// ─────────────────────────────────────────────────────────────

import { type Id, newId, type TimelineClip, type TimelineSequence, type TimelineTrack } from "./model";
import { clipAt, clipsByStart, overlapping } from "./query";

/** How the ops clone a clip when splitting / duplicating. */
export type ClipCloneFn = <C extends TimelineClip>(clip: C) => C;

// Default: a deep clone (structuredClone) — correct for clips whose domain
// payload is small mutable objects (video transform/color/effects), where split
// halves must NOT share those objects. An app whose clips embed LARGE immutable
// payloads (e.g. audio PCM buffers) overrides this with a shallow clone via
// `setClipCloneStrategy`, so the halves SHARE the buffer instead of duplicating
// it. The ops only ever mutate the timing backbone, so a shallow clone is safe
// there as long as the app's per-clip mutations also avoid aliasing.
let _cloneClip: ClipCloneFn = (clip) => structuredClone(clip);

/** Override the clip clone strategy used by the editing ops (see `ClipCloneFn`). */
export function setClipCloneStrategy(fn: ClipCloneFn): void {
  _cloneClip = fn;
}

/** Clone of a clip via the configured strategy, with a fresh id (payload kept). */
export function cloneClip<C extends TimelineClip>(clip: C): C {
  const c = _cloneClip(clip);
  c.id = newId("clip");
  return c;
}

// Smallest meaningful duration/edge margin. Unit-agnostic: tiny enough to be a
// no-op for frame timelines (durations stay whole) and correct for seconds
// timelines (no 1-second minimum). Apps keep clips ≥ 1 of their own unit via
// integer inputs / UI; this only guards degenerate trims.
const EPS = 1e-9;

function sortTrack<C extends TimelineClip>(track: TimelineTrack<C>): void {
  track.clips.sort((a, b) => a.start - b.start);
}

/** Carve out [start, start+len) on a track by trimming/removing overlaps. */
function clearRange<C extends TimelineClip>(track: TimelineTrack<C>, start: number, len: number): void {
  const end = start + len;
  const kept: C[] = [];
  for (const c of track.clips) {
    const cEnd = c.start + c.duration;
    if (cEnd <= start || c.start >= end) {
      kept.push(c);
      continue;
    }
    if (c.start < start) {
      const left = _cloneClip(c);
      left.duration = start - c.start;
      if (left.duration > 0) kept.push(left);
    }
    if (cEnd > end) {
      const right = _cloneClip(c);
      right.id = newId("clip");
      const trimmed = end - c.start;
      right.start = end;
      right.duration = cEnd - end;
      right.inPoint = c.inPoint + (trimmed * c.speed);
      kept.push(right);
    }
  }
  track.clips = kept;
  sortTrack(track);
}

/** Place a clip on a track, overwriting whatever it covers. */
export function overwriteClip<C extends TimelineClip>(track: TimelineTrack<C>, clip: C): void {
  clearRange(track, clip.start, clip.duration);
  track.clips.push(clip);
  sortTrack(track);
}

/** Insert a clip, rippling everything at/after its start later by its length. */
export function insertClip<C extends TimelineClip>(track: TimelineTrack<C>, clip: C): void {
  const len = clip.duration;
  const originals = [...track.clips];
  const tails: C[] = [];
  for (const c of originals) {
    if (c.start >= clip.start) {
      c.start += len;
    } else if (c.start + c.duration > clip.start) {
      const cEnd = c.start + c.duration;
      const tail = _cloneClip(c);
      tail.id = newId("clip");
      const head = clip.start - c.start;
      c.duration = head;
      tail.start = clip.start + len;
      tail.duration = cEnd - clip.start;
      tail.inPoint = c.inPoint + (head * c.speed);
      tails.push(tail);
    }
  }
  track.clips.push(clip, ...tails);
  sortTrack(track);
}

/** Razor: split the clip covering `t` into two. Returns the two clip ids (or []). */
export function splitTrackAt<C extends TimelineClip>(track: TimelineTrack<C>, t: number): Id[] {
  const c = clipAt(track, t);
  if (!c || t <= c.start + EPS || t >= c.start + c.duration - EPS) return [];
  const right = _cloneClip(c);
  right.id = newId("clip");
  const headLen = t - c.start;
  right.start = t;
  right.duration = c.duration - headLen;
  right.inPoint = c.inPoint + (headLen * c.speed);
  c.duration = headLen;
  track.clips.push(right);
  sortTrack(track);
  return [c.id, right.id];
}

/** Lift: remove clips, leaving gaps. */
export function liftClips<C extends TimelineClip>(seq: TimelineSequence<C>, clipIds: Id[]): void {
  const set = new Set(clipIds);
  for (const track of seq.tracks) {
    track.clips = track.clips.filter((c) => !set.has(c.id));
  }
}

/** Ripple-delete: remove clips and pull later clips left to close the gaps. */
export function rippleDeleteClips<C extends TimelineClip>(seq: TimelineSequence<C>, clipIds: Id[]): void {
  const set = new Set(clipIds);
  for (const track of seq.tracks) {
    const removed = track.clips.filter((c) => set.has(c.id));
    if (removed.length === 0) continue;
    track.clips = track.clips.filter((c) => !set.has(c.id));
    for (const r of removed.sort((a, b) => b.start - a.start)) {
      for (const c of track.clips) if (c.start >= r.start + r.duration) c.start -= r.duration;
    }
    sortTrack(track);
  }
}

/** Close the gap immediately to the right of `t` on a track. */
export function closeGapAt<C extends TimelineClip>(track: TimelineTrack<C>, t: number): void {
  const sorted = clipsByStart(track);
  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i];
    if (c.start >= t) {
      const prevEnd = i > 0 ? sorted[i - 1].start + sorted[i - 1].duration : 0;
      const shift = c.start - prevEnd;
      if (shift > 0) {
        for (const cc of track.clips) if (cc.start >= c.start) cc.start -= shift;
      }
      sortTrack(track);
      return;
    }
  }
}

/**
 * Move a clip to a track + start (overwriting the destination). The host app
 * supplies `canDrop` to enforce domain rules (e.g. video-only on video tracks);
 * returns the moved clip's id, or null if not found / not allowed.
 */
export function moveClipToTrack<C extends TimelineClip>(
  seq: TimelineSequence<C>,
  clipId: Id,
  toTrackId: Id,
  toStart: number,
  opts: { copy?: boolean; canDrop?: (from: TimelineTrack<C>, to: TimelineTrack<C>) => boolean } = {},
): Id | null {
  let from: TimelineTrack<C> | null = null;
  let clip: C | null = null;
  for (const track of seq.tracks) {
    const found = track.clips.find((c) => c.id === clipId);
    if (found) {
      from = track;
      clip = found;
      break;
    }
  }
  const dest = seq.tracks.find((t) => t.id === toTrackId) ?? null;
  if (!from || !clip || !dest) return null;
  if (opts.canDrop && !opts.canDrop(from, dest)) return null;
  const moving = opts.copy ? cloneClip(clip) : clip;
  if (!opts.copy) from.clips = from.clips.filter((c) => c.id !== clipId);
  moving.start = Math.max(0, toStart);
  overwriteClip(dest, moving);
  return moving.id;
}

/** Trim the clip's head by `delta` (positive = later in-point / shorter). */
export function trimClipStart<C extends TimelineClip>(track: TimelineTrack<C>, clipId: Id, delta: number): void {
  const c = track.clips.find((x) => x.id === clipId);
  if (!c) return;
  const d = Math.max(-c.start, Math.min(delta, c.duration - EPS));
  c.start += d;
  c.duration -= d;
  c.inPoint = Math.max(0, c.inPoint + (d * c.speed));
}

/** Trim the clip's tail by `delta` (positive = longer). */
export function trimClipEnd<C extends TimelineClip>(track: TimelineTrack<C>, clipId: Id, delta: number): void {
  const c = track.clips.find((x) => x.id === clipId);
  if (!c) return;
  c.duration = Math.max(EPS, c.duration + delta);
}

/** Slip: shift the source in-point without moving the clip on the timeline. */
export function slipClip<C extends TimelineClip>(track: TimelineTrack<C>, clipId: Id, delta: number): void {
  const c = track.clips.find((x) => x.id === clipId);
  if (!c) return;
  c.inPoint = Math.max(0, c.inPoint + (delta * c.speed));
}

/** Slide: move a clip in time, trimming its neighbors to fill/yield. */
export function slideClip<C extends TimelineClip>(track: TimelineTrack<C>, clipId: Id, delta: number): void {
  const sorted = clipsByStart(track);
  const idx = sorted.findIndex((c) => c.id === clipId);
  if (idx < 0) return;
  const c = sorted[idx];
  // (#206) A slide only trims neighbours that TOUCH the clip — the same
  // adjacency rule rollEdit enforces. Across a gap the neighbour is left alone
  // (the clip just slides within the gap): resizing it both changed a clip the
  // user never touched and, since the old clamp used the gap-inclusive
  // distance instead of the neighbour's own duration, drove it NEGATIVE.
  const p = sorted[idx - 1];
  const n = sorted[idx + 1];
  const prev = p && p.start + p.duration === c.start ? p : undefined;
  const next = n && n.start === c.start + c.duration ? n : undefined;
  let d = delta;
  if (prev) d = Math.max(d, -(prev.duration - EPS));
  else if (p) d = Math.max(d, -(c.start - (p.start + p.duration)));
  if (next) d = Math.min(d, next.duration - EPS);
  else if (n) d = Math.min(d, n.start - (c.start + c.duration));
  c.start += d;
  if (prev) prev.duration += d;
  if (next) {
    next.start += d;
    next.duration -= d;
    next.inPoint = Math.max(0, next.inPoint + (d * next.speed));
  }
}

/** Rolling edit: move the cut between two adjacent clips by `delta`. */
export function rollEdit<C extends TimelineClip>(track: TimelineTrack<C>, leftId: Id, delta: number): void {
  const sorted = clipsByStart(track);
  const idx = sorted.findIndex((c) => c.id === leftId);
  const left = sorted[idx];
  const right = sorted[idx + 1];
  if (!left || !right || right.start !== left.start + left.duration) return;
  const d = Math.max(-(left.duration - EPS), Math.min(delta, right.duration - EPS));
  left.duration += d;
  right.start += d;
  right.duration -= d;
  right.inPoint = Math.max(0, right.inPoint + (d * right.speed));
}

/** Change a clip's speed, optionally keeping its timeline duration. */
export function setClipSpeed<C extends TimelineClip>(track: TimelineTrack<C>, clipId: Id, speed: number, keepDuration = false): void {
  const c = track.clips.find((x) => x.id === clipId);
  if (!c || speed === 0) return;
  const oldSpeed = c.speed;
  c.speed = speed;
  if (!keepDuration) {
    const sourceSpan = c.duration * oldSpeed;
    // (#207) Unit-agnostic like every other op: no whole-unit rounding and no
    // 1-unit floor (that turned a 1.2s clip at 4× into 1s instead of 0.3s, and
    // collapsed any reversed clip to 1). A frames host quantizes on its side.
    // |speed| so a reverse speed keeps the same source span.
    c.duration = Math.max(EPS, Math.abs(sourceSpan / speed));
  }
}

/** True if [start,len) would overlap an existing clip on `track`. */
export function wouldOverlap<C extends TimelineClip>(track: TimelineTrack<C>, start: number, len: number, excludeId?: Id): boolean {
  return overlapping(track, start, len, excludeId).length > 0;
}
