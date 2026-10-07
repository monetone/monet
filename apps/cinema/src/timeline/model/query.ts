// ─────────────────────────────────────────────────────────────
// query.ts — read-only queries over the Cinema timeline.
//
// The generic, domain-agnostic selectors (clipAt, overlapping, edges, snap, …)
// come from the shared @monet-ui/monet-timeline engine — Cinema's
// Sequence/Track/Clip structurally satisfy the engine's generic types. This
// module re-exports those and adds the Cinema-specific selectors (media lookup,
// video/audio visibility rules, sequence duration). Tracks are stored
// video-first then audio; compositing stack order = video track index.
// ─────────────────────────────────────────────────────────────

import { sourceFrameAt } from "../time/timecode";
import type { Clip, Id, Project, Sequence, Track } from "./types";
import {
  clipAt,
  clipCovers,
  clipsByStart,
  contentEnd,
  isRangeFree,
  nextEdge,
  overlapping,
  prevEdge,
  snapTime,
} from "@monet-ui/monet-timeline";

// Generic engine selectors, re-exported for Cinema's existing import sites.
// `snapTime` is surfaced under Cinema's historical `snapFrame` name.
export { clipAt, clipCovers, clipsByStart, contentEnd, isRangeFree, nextEdge, overlapping, prevEdge };
export { snapTime as snapFrame };

// ── Cinema-specific selectors ─────────────────────────────────
export function activeSequence(project: Project): Sequence | null {
  return project.sequences.find((s) => s.id === project.activeSequenceId) ?? project.sequences[0] ?? null;
}

export function findSequence(project: Project, id: Id): Sequence | null {
  return project.sequences.find((s) => s.id === id) ?? null;
}

export function findMedia(project: Project, id: Id) {
  return project.media.find((m) => m.id === id) ?? null;
}

export function videoTracks(seq: Sequence): Track[] {
  return seq.tracks.filter((t) => t.kind === "video");
}

export function audioTracks(seq: Sequence): Track[] {
  return seq.tracks.filter((t) => t.kind === "audio");
}

export function findTrack(seq: Sequence, trackId: Id): Track | null {
  return seq.tracks.find((t) => t.id === trackId) ?? null;
}

export interface ClipHit {
  track: Track;
  clip: Clip;
}

export function findClip(seq: Sequence, clipId: Id): ClipHit | null {
  for (const track of seq.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { track, clip };
  }
  return null;
}

export function trackOfClip(seq: Sequence, clipId: Id): Track | null {
  return findClip(seq, clipId)?.track ?? null;
}

/**
 * Visible video clips at `frame`, bottom-to-top (compositing order). Skips
 * disabled clips and disabled/locked-output tracks; respects solo.
 */
export function videoClipsAt(seq: Sequence, frame: number): ClipHit[] {
  const vts = videoTracks(seq);
  const soloed = vts.some((t) => t.solo);
  const hits: ClipHit[] = [];
  for (const track of vts) {
    if (!track.enabled) continue;
    if (soloed && !track.solo) continue;
    const clip = clipAt(track, frame);
    if (clip && clip.enabled) hits.push({ track, clip });
  }
  return hits;
}

/** Audible audio clips at `frame` (respecting mute/solo). */
export function audioClipsAt(seq: Sequence, frame: number): ClipHit[] {
  const ats = audioTracks(seq);
  const soloed = ats.some((t) => t.solo);
  const hits: ClipHit[] = [];
  for (const track of ats) {
    if (track.muted) continue;
    if (soloed && !track.solo) continue;
    const clip = clipAt(track, frame);
    if (clip && clip.enabled) hits.push({ track, clip });
  }
  return hits;
}

/** The source frame a clip shows at a given timeline frame. */
export function clipSourceFrame(clip: Clip, timelineFrame: number): number {
  return sourceFrameAt(timelineFrame, clip.start, clip.inPoint, clip.speed);
}

/** Effective sequence length: max(explicit duration, content extent). */
export function sequenceDuration(seq: Sequence): number {
  return Math.max(seq.durationFrames, contentEnd(seq));
}
