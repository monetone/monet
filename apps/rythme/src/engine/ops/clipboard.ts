// ─────────────────────────────────────────────────────────────
// engine/ops/clipboard — copy / cut / paste over a time range
// ─────────────────────────────────────────────────────────────
// A Clipboard captures the clips inside a time range, clipped to that range,
// with start times made relative to the range origin. Paste re-anchors them at
// a destination time on chosen tracks, optionally rippling to make room.

import { invertPolarity } from "../dsp/basic";
import { nextId } from "../model/ids";
import { clipEnd, clipIntersectsRange, trackById } from "../model/query";
import type { Clip, Clipboard, ClipboardTrack, Project } from "../model/types";
import { deleteRange, insertSilence } from "./range";

export type { Clipboard, ClipboardTrack } from "../model/types";

/** Clip a single clip to [start, end) with start re-based to the range origin. */
function clipToRange(c: Clip, start: number, end: number): Clip {
  const newStart = Math.max(c.start, start);
  const newEnd = Math.min(clipEnd(c), end);
  const headTrim = newStart - c.start;
  return {
    ...c,
    id: nextId("clip"),
    start: newStart - start,
    inPoint: c.inPoint + headTrim,
    duration: newEnd - newStart,
    fadeIn: headTrim > 1e-9 ? 0 : c.fadeIn,
    fadeOut: newEnd < clipEnd(c) - 1e-9 ? 0 : c.fadeOut,
  };
}

/** Copy the clips in [start, end) across the given tracks. */
export function copyRange(p: Project, start: number, end: number, trackIds: string[]): Clipboard {
  const tracks: ClipboardTrack[] = [];
  for (const id of trackIds) {
    const track = trackById(p, id);
    if (!track) continue;
    const clips = track.clips
      .filter((c) => clipIntersectsRange(c, start, end))
      .map((c) => clipToRange(c, start, end));
    tracks.push({ sourceTrackId: id, clips });
  }
  return { duration: end - start, tracks };
}

/** Cut = copy then ripple-delete the range. */
export function cutRange(p: Project, start: number, end: number, trackIds: string[]): { project: Project; clipboard: Clipboard } {
  return { clipboard: copyRange(p, start, end, trackIds), project: deleteRange(p, start, end, trackIds, true) };
}

export interface PasteOptions {
  /** Destination track ids parallel to clipboard.tracks; defaults to sources. */
  targetTrackIds?: string[];
  /** Insert silence first so existing audio shifts right to make room. */
  ripple?: boolean;
  /** Gain (dB) added to each pasted clip's trim — Mix Paste's Volume. */
  gainDb?: number;
  /** Phase-invert the pasted material — Mix Paste's Invert (for null tests). */
  invert?: boolean;
}

/** Paste a clipboard at `at` seconds. */
export function pasteAt(p: Project, at: number, clipboard: Clipboard, opts: PasteOptions = {}): Project {
  let proj = p;
  const targets = opts.targetTrackIds;
  if (opts.ripple) {
    const trackIds = targets ?? clipboard.tracks.map((t) => t.sourceTrackId);
    proj = insertSilence(proj, at, clipboard.duration, trackIds);
  }
  for (let i = 0; i < clipboard.tracks.length; i++) {
    const cbTrack = clipboard.tracks[i];
    const targetId = targets?.[i] ?? cbTrack.sourceTrackId;
    const track = trackById(proj, targetId);
    if (!track) continue;
    const pasted = cbTrack.clips.map((c) => ({
      ...c,
      id: nextId("clip"),
      trackId: targetId,
      start: at + c.start,
      gainDb: c.gainDb + (opts.gainDb ?? 0), // Mix Paste Volume (additive trim)
      buffer: opts.invert ? invertPolarity(c.buffer) : c.buffer, // Mix Paste Invert
    }));
    proj = {
      ...proj,
      tracks: proj.tracks.map((t) => (t.id === targetId ? { ...t, clips: [...t.clips, ...pasted] } : t)),
    };
  }
  return proj;
}
