// ─────────────────────────────────────────────────────────────
// engine/ops/range — time-range edits (Audacity-style)
// ─────────────────────────────────────────────────────────────
// Range edits split clips at the range boundaries and then act on whole clips.
// A gap between clips plays as silence, so "silence/clear" is simply a
// non-rippling delete; "delete/cut" ripples later clips left to close the gap.

import { clipEnd } from "../model/query";
import type { Project, Track } from "../model/types";
import { splitAt } from "./clip";

const EPS = 1e-9;

function affected(trackIds: string[] | undefined): Set<string> | null {
  return trackIds ? new Set(trackIds) : null;
}

/**
 * Remove the audio in [start, end) on the given tracks. With `ripple` (the
 * default), clips after the range shift left to close the gap (Cut/Delete);
 * without it, the gap is left as silence (Silence/Clear/Split-Delete).
 */
export function deleteRange(
  p: Project,
  start: number,
  end: number,
  trackIds?: string[],
  ripple = true,
): Project {
  if (end <= start) return p;
  const aligned = splitAt(splitAt(p, start, trackIds), end, trackIds);
  const set = affected(trackIds);
  const len = end - start;
  const tracks = aligned.tracks.map((t): Track => {
    if (set && !set.has(t.id)) return t;
    let clips = t.clips.filter((c) => !(c.start >= start - EPS && clipEnd(c) <= end + EPS));
    if (ripple) clips = clips.map((c) => (c.start >= end - EPS ? { ...c, start: c.start - len } : c));
    return { ...t, clips };
  });
  return { ...aligned, tracks };
}

/** Replace [start, end) with silence (a non-rippling delete). */
export function silenceRange(p: Project, start: number, end: number, trackIds?: string[]): Project {
  return deleteRange(p, start, end, trackIds, false);
}

/** Insert `duration` seconds of silence at `at`, pushing later clips right. */
export function insertSilence(p: Project, at: number, duration: number, trackIds?: string[]): Project {
  if (duration <= 0) return p;
  const aligned = splitAt(p, at, trackIds);
  const set = affected(trackIds);
  const tracks = aligned.tracks.map((t): Track => {
    if (set && !set.has(t.id)) return t;
    return { ...t, clips: t.clips.map((c) => (c.start >= at - EPS ? { ...c, start: c.start + duration } : c)) };
  });
  return { ...aligned, tracks };
}

/** Keep only [start, end) on the given tracks and shift it to time 0. */
export function trimToRange(p: Project, start: number, end: number, trackIds?: string[]): Project {
  if (end <= start) return p;
  const aligned = splitAt(splitAt(p, start, trackIds), end, trackIds);
  const set = affected(trackIds);
  const tracks = aligned.tracks.map((t): Track => {
    if (set && !set.has(t.id)) return t;
    const clips = t.clips
      .filter((c) => c.start >= start - EPS && clipEnd(c) <= end + EPS)
      .map((c) => ({ ...c, start: c.start - start }));
    return { ...t, clips };
  });
  return { ...aligned, tracks };
}
