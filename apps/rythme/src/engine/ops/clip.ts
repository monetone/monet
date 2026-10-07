// ─────────────────────────────────────────────────────────────
// engine/ops/clip — non-destructive clip edits
// ─────────────────────────────────────────────────────────────
// Pure `(project, …) => project` transforms with structural sharing (untouched
// buffers shared by reference). Rythme clips are @monet-ui/monet-timeline
// `TimelineClip`s (in-point = `inPoint`, seconds), so the ops whose semantics
// match the shared engine — RAZOR (split) and CLONE — delegate to it; the
// shared ops shallow-clone (see the clone strategy below) so split halves SHARE
// the PCM buffer. Edits whose semantics are audio-specific (a move that does NOT
// overwrite, a trim clamped by the source in-point) stay Rythme's own.

import { cloneClip as sharedClone, setClipCloneStrategy, splitTrackAt as sharedSplitTrack } from "@monet-ui/monet-timeline";
import { durationSeconds } from "../audio/types";
import { nextId } from "../model/ids";
import { clipById, clipEnd } from "../model/query";
import type { Clip, FadeShape, Project, Track } from "../model/types";

// Rythme clips embed PCM (a Float32Array buffer). Tell the shared ops to
// SHALLOW-clone a clip on split/duplicate so the new clip shares the buffer
// instead of deep-copying it (the ops only ever touch the timing backbone).
const shallowCloneClip: <C extends Clip>(c: C) => C = (c) => ({ ...c });
setClipCloneStrategy(shallowCloneClip as Parameters<typeof setClipCloneStrategy>[0]);

function mapTrack(p: Project, trackId: string, fn: (t: Track) => Track): Project {
  let changed = false;
  const tracks = p.tracks.map((t) => {
    if (t.id !== trackId) return t;
    changed = true;
    return fn(t);
  });
  return changed ? { ...p, tracks } : p;
}

function mapClip(p: Project, clipId: string, fn: (c: Clip) => Clip): Project {
  const found = clipById(p, clipId);
  if (!found) return p;
  return mapTrack(p, found.track.id, (t) => ({
    ...t,
    clips: t.clips.map((c) => (c.id === clipId ? fn(c) : c)),
  }));
}

/** Add a clip to a track (append — does NOT overwrite). */
export function addClip(p: Project, trackId: string, clip: Clip): Project {
  return mapTrack(p, trackId, (t) => ({ ...t, clips: [...t.clips, { ...clip, trackId }] }));
}

/** Remove a clip by id. */
export function deleteClip(p: Project, clipId: string): Project {
  const found = clipById(p, clipId);
  if (!found) return p;
  return mapTrack(p, found.track.id, (t) => ({ ...t, clips: t.clips.filter((c) => c.id !== clipId) }));
}

/**
 * Razor: split every clip on a track that straddles `time` into two — delegated
 * to the shared engine's `splitTrackAt` (which shallow-clones, so the halves
 * share the buffer), then reset the fade that now straddles the cut (audio).
 * Returns the SAME track if nothing straddles `time` (so dispatch can no-op).
 */
export function splitTrackAt(track: Track, time: number): Track {
  const straddles = track.clips.some((c) => time > c.start + 1e-9 && time < clipEnd(c) - 1e-9);
  if (!straddles) return track;
  // Draft the track with shallow-cloned clips so the shared (mutating) op never
  // touches the originals — Rythme's ops stay pure.
  const t: Track = { ...track, clips: track.clips.map((c) => ({ ...c })) };
  const ids = sharedSplitTrack(t, time);
  if (ids.length === 2) {
    const left = t.clips.find((c) => c.id === ids[0]);
    const right = t.clips.find((c) => c.id === ids[1]);
    if (left) left.fadeOut = 0;
    if (right) right.fadeIn = 0;
  }
  return t;
}

/** Split clips at `time` on the given tracks (or all tracks if omitted). */
export function splitAt(p: Project, time: number, trackIds?: string[]): Project {
  const set = trackIds ? new Set(trackIds) : null;
  let changed = false;
  const tracks = p.tracks.map((t) => {
    if (set && !set.has(t.id)) return t;
    const next = splitTrackAt(t, time);
    if (next !== t) changed = true;
    return next;
  });
  return changed ? { ...p, tracks } : p;
}

/** Map every clip in the project (structural sharing on the tracks). */
function mapAllClips(p: Project, fn: (c: Clip) => Clip): Project {
  return { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.map(fn) })) };
}

/** Move a clip to a new start time, optionally to a different track. Audio
 *  semantics: clips MAY overlap on a lane (no overwrite), unlike a video NLE.
 *  A time-only move of a GROUPED clip shifts every group member by the same
 *  delta (clamped so the earliest member stays at ≥ 0). */
export function moveClip(p: Project, clipId: string, newStart: number, newTrackId?: string): Project {
  const found = clipById(p, clipId);
  if (!found) return p;
  if (found.clip.locked) return p; // a clip locked in time stays put
  const start = Math.max(0, newStart);
  const gid = found.clip.groupId;
  if (gid && (!newTrackId || newTrackId === found.track.id)) {
    let minStart = Infinity;
    let anyLocked = false;
    for (const t of p.tracks) for (const c of t.clips) if (c.groupId === gid) { minStart = Math.min(minStart, c.start); if (c.locked) anyLocked = true; }
    if (anyLocked) return p; // a group can't move while any member is locked in time
    const delta = Math.max(start - found.clip.start, -minStart); // don't drag the earliest member below 0
    if (delta === 0) return p;
    return mapAllClips(p, (c) => (c.groupId === gid ? { ...c, start: c.start + delta } : c));
  }
  if (!newTrackId || newTrackId === found.track.id) {
    if (found.clip.start === start) return p; // position unchanged (e.g. clamped at t=0) → same ref, like the group branch
    return mapClip(p, clipId, (c) => ({ ...c, start }));
  }
  const moved: Clip = { ...found.clip, start, trackId: newTrackId };
  return addClip(deleteClip(p, clipId), newTrackId, moved);
}

/** Group clips so they move together (Audition's Group Clips). A fresh group id
 *  is set on each selected clip; clips already grouped are re-grouped. No-op for
 *  fewer than two clips. */
export function groupClips(p: Project, clipIds: string[]): Project {
  if (clipIds.length < 2) return p;
  const ids = new Set(clipIds);
  const groupId = nextId("group");
  return mapAllClips(p, (c) => (ids.has(c.id) ? { ...c, groupId } : c));
}

/** Remove the given clips from their group. Same ref when none were grouped. */
export function ungroupClips(p: Project, clipIds: string[]): Project {
  const ids = new Set(clipIds);
  let changed = false;
  const out = mapAllClips(p, (c) => {
    if (ids.has(c.id) && c.groupId !== undefined) {
      changed = true;
      return { ...c, groupId: undefined };
    }
    return c;
  });
  return changed ? out : p;
}

/** Duplicate a clip (sharing its buffer via the shared clone), offset on the
 *  timeline by `gap` seconds (default: end-to-end). */
export function duplicateClip(p: Project, clipId: string, gap?: number): Project {
  const found = clipById(p, clipId);
  if (!found) return p;
  const c = found.clip;
  // A duplicate is an independent clip: it does NOT inherit the source's group, and
  // it's movable (the op places it at a fresh position) even if the source is locked.
  const copy: Clip = { ...sharedClone(c), name: `${c.name} copy`, start: c.start + (gap ?? c.duration), groupId: undefined, locked: undefined };
  return addClip(p, found.track.id, copy);
}

/** Set the clip's gain trim (dB). */
export function setClipGain(p: Project, clipId: string, gainDb: number): Project {
  return mapClip(p, clipId, (c) => ({ ...c, gainDb }));
}

/** Mute or un-mute a clip (muted clips render silent but stay on the timeline). */
export function setClipMuted(p: Project, clipId: string, muted: boolean): Project {
  return mapClip(p, clipId, (c) => ({ ...c, muted }));
}

/** Lock or unlock a clip's timeline position (locked clips can't be moved). */
export function setClipLocked(p: Project, clipId: string, locked: boolean): Project {
  return mapClip(p, clipId, (c) => ({ ...c, locked }));
}

/** Loop a clip `times` repeats of its source (Audition's clip Loop). `times` ≥ 2
 *  sets the duration to that many copies of the source-from-inPoint and marks the
 *  clip looped; `times` = 1 turns looping off and restores a single play. */
export function setClipLoop(p: Project, clipId: string, times: number): Project {
  return mapClip(p, clipId, (c) => {
    const base = Math.max(0, durationSeconds(c.buffer) - c.inPoint); // loop unit: source from inPoint to its end
    const n = Math.max(1, Math.floor(times));
    return { ...c, looped: n > 1, duration: n * base };
  });
}

export interface FadeEdit {
  fadeIn?: number;
  fadeOut?: number;
  fadeInShape?: FadeShape;
  fadeOutShape?: FadeShape;
}

/** Set the clip's fades. Lengths are clamped to the clip duration. */
export function setClipFades(p: Project, clipId: string, edit: FadeEdit): Project {
  return mapClip(p, clipId, (c) => {
    const fadeIn = Math.max(0, Math.min(c.duration, edit.fadeIn ?? c.fadeIn));
    const fadeOut = Math.max(0, Math.min(c.duration, edit.fadeOut ?? c.fadeOut));
    return {
      ...c,
      fadeIn,
      fadeOut,
      fadeInShape: edit.fadeInShape ?? c.fadeInShape,
      fadeOutShape: edit.fadeOutShape ?? c.fadeOutShape,
    };
  });
}

/**
 * Trim a clip edge by dragging. `leftDelta` moves the left edge (positive =
 * later, revealing less head); `rightDelta` moves the right edge. The in-point
 * and duration are kept consistent and non-negative. Audio semantics: the left
 * edge is clamped by the source in-point (can't reveal before the source head).
 */
export function trimClipEdges(p: Project, clipId: string, leftDelta: number, rightDelta: number): Project {
  return mapClip(p, clipId, (c) => {
    let { start, inPoint, duration } = c;
    if (leftDelta !== 0) {
      const d = Math.max(-inPoint, Math.min(duration - 0.001, leftDelta));
      start += d;
      inPoint += d;
      duration -= d;
    }
    if (rightDelta !== 0) {
      duration = Math.max(0.001, duration + rightDelta);
    }
    return { ...c, start, inPoint, duration };
  });
}
