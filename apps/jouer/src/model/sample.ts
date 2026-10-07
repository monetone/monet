// ─────────────────────────────────────────────────────────────
// sample.ts — pure timeline sampling. Given a Timeline and a time t (seconds),
// produce the animated property overrides for each target object. Used by the
// live editor preview (scrubbing the playhead) and the in-editor player; the
// Phaser code export turns the same tracks into native tweens instead.
//
// Framework-free + deterministic → unit-tested in node.
// ─────────────────────────────────────────────────────────────

import { easeFn } from "./ease";
import type { AnimTrack, Id, Timeline, TrackProperty } from "./types";

export type PropOverrides = Partial<Record<TrackProperty, number>>;
export type SampleResult = Map<Id, PropOverrides>;

/** Interpolate a single track at time t. Returns undefined for an empty track.
 *  Clamps to the first/last keyframe value outside the keyframe range (a "hold"
 *  ease produces a stepped result inside a segment). */
export function sampleTrack(track: AnimTrack, t: number): number | undefined {
  const kfs = track.keyframes;
  if (kfs.length === 0) return undefined;
  if (kfs.length === 1) return kfs[0].value;
  if (t <= kfs[0].time) return kfs[0].value;
  const last = kfs[kfs.length - 1];
  if (t >= last.time) return last.value;

  // Find the segment [a, b] containing t (keyframes are kept sorted).
  let a = kfs[0];
  let b = kfs[1];
  for (let i = 0; i < kfs.length - 1; i++) {
    if (t >= kfs[i].time && t <= kfs[i + 1].time) {
      a = kfs[i];
      b = kfs[i + 1];
      break;
    }
  }
  const span = b.time - a.time;
  const local = span <= 0 ? 1 : (t - a.time) / span;
  const eased = easeFn(a.ease)(Math.max(0, Math.min(1, local)));
  return a.value + (b.value - a.value) * eased;
}

/** Sample every track of a timeline at time t, grouped by target object id. */
/** A timeline's active (non-muted) tracks — Unity Timeline track mute. The single
 *  source the editor preview, the player and the export all filter through, so a
 *  muted track is uniformly skipped. */
export function activeTracks(timeline: Timeline): AnimTrack[] {
  // Unity Timeline solo: when any track is soloed, only soloed tracks play; mute
  // always silences. With nothing soloed this is the plain not-muted set.
  const soloing = timeline.tracks.some((track) => track.solo);
  return timeline.tracks.filter((track) => !track.muted && (!soloing || track.solo));
}

export function sampleTimeline(timeline: Timeline, t: number): SampleResult {
  const result: SampleResult = new Map();
  for (const track of activeTracks(timeline)) {
    const v = sampleTrack(track, t);
    if (v === undefined) continue;
    let bag = result.get(track.targetId);
    if (!bag) {
      bag = {};
      result.set(track.targetId, bag);
    }
    bag[track.property] = v;
  }
  return result;
}

/** The effective playable length of a timeline: the max of its declared
 *  duration and the latest keyframe across all tracks. */
export function timelineExtent(timeline: Timeline): number {
  let max = timeline.duration;
  for (const track of timeline.tracks) {
    const last = track.keyframes[track.keyframes.length - 1];
    if (last && last.time > max) max = last.time;
  }
  return max;
}
