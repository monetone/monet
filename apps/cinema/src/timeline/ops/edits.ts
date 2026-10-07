// ─────────────────────────────────────────────────────────────
// edits.ts — Cinema timeline edits.
//
// The generic, domain-agnostic editing operations (insert/overwrite, ripple,
// razor timing, trim, slip/slide/roll, gap-close, move, speed) come from the
// shared @monet-ui/monet-timeline engine — Cinema's Clip satisfies the engine's
// `TimelineClip`, so they apply directly and preserve Cinema's per-clip payload
// (transform/color/effects/transitions) via structuredClone. This module
// re-exports those and layers Cinema's domain behavior on top: clearing the
// transitions/fades that straddle a new cut, refusing cross-kind moves, dropping
// the linked-clip pairing on duplicate, and the video-specific transition/effect
// /track/place operations.
// ─────────────────────────────────────────────────────────────

import { createClip } from "../model/factory";
import { findClip } from "../model/query";
import type { Clip, Effect, Id, Sequence, Track, Transition, TransitionKind } from "../model/types";
import {
  clipCovers,
  cloneClip,
  closeGapAt,
  insertClip,
  liftClips,
  moveClipToTrack,
  overwriteClip,
  rippleDeleteClips,
  rollEdit,
  setClipSpeed,
  slideClip,
  slipClip,
  splitTrackAt as splitTimingAt,
  trimClipEnd,
  trimClipStart,
  wouldOverlap,
} from "@monet-ui/monet-timeline";

// Generic ops, re-exported unchanged for Cinema's command/UI import sites.
export {
  clipCovers,
  closeGapAt,
  insertClip,
  liftClips,
  overwriteClip,
  rippleDeleteClips,
  rollEdit,
  setClipSpeed,
  slideClip,
  slipClip,
  trimClipEnd,
  trimClipStart,
  wouldOverlap,
};

// ── Cinema-specific edits ─────────────────────────────────────

/** Clone a clip with a fresh id, dropping its linked A/V counterpart pairing. */
export function duplicateClip(clip: Clip): Clip {
  const c = cloneClip(clip);
  c.linkedId = undefined;
  return c;
}

/** Razor: generic timing split, then clear the transitions/fades straddling the new cut. */
export function splitTrackAt(track: Track, frame: number): Id[] {
  const ids = splitTimingAt(track, frame);
  if (ids.length === 2) {
    const left = track.clips.find((c) => c.id === ids[0]);
    const right = track.clips.find((c) => c.id === ids[1]);
    if (left) {
      left.transitionOut = undefined;
      left.fadeOutFrames = 0;
    }
    if (right) {
      right.transitionIn = undefined;
      right.fadeInFrames = 0;
    }
  }
  return ids;
}

/** Razor across every unlocked track at `frame` (the C tool, no modifier). */
export function splitAllTracksAt(seq: Sequence, frame: number): Id[] {
  const ids: Id[] = [];
  for (const track of seq.tracks) {
    if (track.locked) continue;
    ids.push(...splitTrackAt(track, frame));
  }
  return ids;
}

/** Move a clip to a track + start; refuses cross-kind drops (video can't land on audio). */
export function moveClip(seq: Sequence, clipId: Id, toTrackId: Id, toStart: number, opts: { copy?: boolean } = {}): Id | null {
  return moveClipToTrack(seq, clipId, toTrackId, toStart, {
    copy: opts.copy,
    canDrop: (from, to) => (from as Track).kind === (to as Track).kind,
  });
}

export function addTrack(seq: Sequence, track: Track, atIndex?: number): void {
  if (atIndex == null) seq.tracks.push(track);
  else seq.tracks.splice(atIndex, 0, track);
}

export function removeTrack(seq: Sequence, trackId: Id): void {
  seq.tracks = seq.tracks.filter((t) => t.id !== trackId);
}

export function addTransition(
  seq: Sequence,
  clipId: Id,
  side: "in" | "out",
  kind: TransitionKind,
  durationFrames: number,
  angle = 0,
): void {
  const c = findClip(seq, clipId)?.clip;
  if (!c) return;
  const t: Transition = { kind, durationFrames, angle };
  if (side === "in") c.transitionIn = t;
  else c.transitionOut = t;
}

export function removeTransition(seq: Sequence, clipId: Id, side: "in" | "out"): void {
  const c = findClip(seq, clipId)?.clip;
  if (!c) return;
  if (side === "in") c.transitionIn = undefined;
  else c.transitionOut = undefined;
}

export function addEffect(seq: Sequence, clipId: Id, effect: Effect): void {
  findClip(seq, clipId)?.clip.effects.push(effect);
}

export function removeEffect(seq: Sequence, clipId: Id, effectId: Id): void {
  const c = findClip(seq, clipId)?.clip;
  if (c) c.effects = c.effects.filter((e) => e.id !== effectId);
}

export function toggleEffect(seq: Sequence, clipId: Id, effectId: Id): void {
  const e = findClip(seq, clipId)?.clip.effects.find((x) => x.id === effectId);
  if (e) e.enabled = !e.enabled;
}

/** Place media as a new clip on a track at `frame` (insert/ripple or overwrite). */
export function placeMedia(
  track: Track,
  opts: {
    mediaId: Id;
    name: string;
    kind: Clip["kind"];
    inPoint: number;
    duration: number;
    frame: number;
    ripple?: boolean;
  },
): Clip {
  const clip = createClip({
    mediaId: opts.mediaId,
    name: opts.name,
    kind: opts.kind,
    start: opts.frame,
    duration: opts.duration,
    inPoint: opts.inPoint,
  });
  if (opts.ripple) insertClip(track, clip);
  else overwriteClip(track, clip);
  return clip;
}
