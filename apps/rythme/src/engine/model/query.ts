// ─────────────────────────────────────────────────────────────
// engine/model/query — read-only selectors over the model
// ─────────────────────────────────────────────────────────────
// Pure lookups and derived geometry. No mutation; safe to call from anywhere
// (engine ops, UI render, tests).

import { contentEnd } from "@monet-ui/monet-timeline";
import type { Bus, Clip, Marker, Project, Seconds, Track, VideoAsset, VideoClip, VideoTrack } from "./types";

// Snapping + edge navigation come from the shared @monet-ui/monet-timeline
// engine (they operate on the TimelineSpan backbone, so they work in seconds).
// Rythme previously had no snap; pass the Project as the sequence + a threshold
// in seconds. `snapTime(project, t, thresholdSec)`, `nextEdge`/`prevEdge`.
export { nextEdge, prevEdge, snapTime } from "@monet-ui/monet-timeline";

export function trackById(p: Project, id: string): Track | undefined {
  return p.tracks.find((t) => t.id === id);
}

export function trackIndex(p: Project, id: string): number {
  return p.tracks.findIndex((t) => t.id === id);
}

export function busById(p: Project, id: string): Bus | undefined {
  return (p.buses ?? []).find((b) => b.id === id);
}

export function busIndex(p: Project, id: string): number {
  return (p.buses ?? []).findIndex((b) => b.id === id);
}

export function clipById(p: Project, id: string): { clip: Clip; track: Track } | undefined {
  for (const track of p.tracks) {
    const clip = track.clips.find((c) => c.id === id);
    if (clip) return { clip, track };
  }
  return undefined;
}

export function videoAssetById(p: Project, id: string): VideoAsset | undefined {
  return (p.videoAssets ?? []).find((asset) => asset.id === id);
}

export function videoClipById(p: Project, id: string): { clip: VideoClip; track: VideoTrack } | undefined {
  for (const track of p.videoTracks ?? []) {
    const clip = track.clips.find((c) => c.id === id);
    if (clip) return { clip, track };
  }
  return undefined;
}

export function activeVideoClipAt(p: Project, time: Seconds): { clip: VideoClip; track: VideoTrack; asset?: VideoAsset } | undefined {
  for (const track of p.videoTracks ?? []) {
    if (track.visible === false) continue;
    const clip = track.clips.find((c) => c.enabled && time >= c.start && time < clipEnd(c));
    if (clip) return { clip, track, asset: videoAssetById(p, clip.assetId) };
  }
  return undefined;
}

/** Timeline end of a clip (start + duration). */
export function clipEnd(c: Pick<Clip, "start" | "duration">): Seconds {
  return c.start + c.duration;
}

/** Does the clip overlap the half-open time range [start, end)? */
export function clipIntersectsRange(c: Clip, start: Seconds, end: Seconds): boolean {
  return c.start < end && clipEnd(c) > start;
}

/** Clips on a track overlapping [start, end), in timeline order. */
export function clipsInRange(track: Track, start: Seconds, end: Seconds): Clip[] {
  return track.clips.filter((c) => clipIntersectsRange(c, start, end)).sort((a, b) => a.start - b.start);
}

/** Whether `solo` is engaged on any track (changes audibility rules). */
export function anySolo(p: Project): boolean {
  return p.tracks.some((t) => t.solo);
}

/** Is the track audible given the project's mute/solo state? */
export function trackAudible(p: Project, t: Track): boolean {
  if (t.mute) return false;
  return anySolo(p) ? t.solo : true;
}

/** Whether `solo` is engaged on any bus. */
export function anyBusSolo(p: Project): boolean {
  return (p.buses ?? []).some((b) => b.solo);
}

/** Is the bus audible given bus mute/solo state. */
export function busAudible(p: Project, b: Bus): boolean {
  if (b.mute) return false;
  return anyBusSolo(p) ? b.solo : true;
}

/** Total project duration: the furthest clip end across all tracks (seconds).
 *  Delegates to the shared engine's `contentEnd` (Project satisfies its generic
 *  `TimelineSequence` via Track ▸ TimelineTrack<Clip>). */
export function projectDuration(p: Project): Seconds {
  let end = contentEnd(p);
  for (const track of p.videoTracks ?? []) for (const clip of track.clips) end = Math.max(end, clipEnd(clip));
  return end;
}

/** Markers sorted by time. */
export function sortedMarkers(p: Project): Marker[] {
  return [...p.markers].sort((a, b) => a.time - b.time);
}

/** Seconds → musical bars/beats given tempo & signature (1-based bar.beat). */
export function secondsToBarsBeats(p: Project, seconds: Seconds): { bar: number; beat: number; ticks: number } {
  const beatsPerSec = p.tempo / 60;
  const totalBeats = seconds * beatsPerSec;
  const beatsPerBar = p.timeSignature[0];
  const bar = Math.floor(totalBeats / beatsPerBar);
  const beatInBar = totalBeats - bar * beatsPerBar;
  const beat = Math.floor(beatInBar);
  const ticks = Math.round((beatInBar - beat) * 960); // 960 PPQ
  return { bar: bar + 1, beat: beat + 1, ticks };
}

/** Duration of one beat in seconds, for grid snapping. */
export function beatDuration(p: Project): Seconds {
  return 60 / p.tempo;
}
