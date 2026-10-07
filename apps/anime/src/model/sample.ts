// ─────────────────────────────────────────────────────────────
// sample.ts — pure keyframe sampling. The SAME evaluator powers live scrubbing
// and playback, so preview == render. Adapted from Monet Jouer (per-layer here).
// ─────────────────────────────────────────────────────────────

import { easeFn } from "./ease";
import type { AnimTrack, Composition, Layer, Transform, TrackProperty } from "./types";

/** Interpolate one track at time t (seconds). Clamps to endpoints outside the
 *  keyframe range; a "hold" ease produces a stepped result within a segment. */
export function sampleTrack(track: AnimTrack, t: number): number | undefined {
  const kfs = track.keyframes;
  if (kfs.length === 0) return undefined;
  if (kfs.length === 1) return kfs[0].value;
  if (t <= kfs[0].time) return kfs[0].value;
  const last = kfs[kfs.length - 1];
  if (t >= last.time) return last.value;

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

/** A layer's effective Transform at time t: base values with keyframed overrides. */
export function effectiveTransform(layer: Layer, t: number): Transform {
  const xf: Transform = { ...layer.transform };
  for (const track of layer.tracks) {
    const v = sampleTrack(track, t);
    if (v !== undefined) (xf as Record<TrackProperty, number>)[track.property] = v;
  }
  return xf;
}

/** Is a layer live (rendered) at time t? */
export function layerLive(layer: Layer, t: number): boolean {
  return layer.visible && t >= layer.inPoint && t < layer.outPoint;
}

/** The effective playable length: max of declared duration and latest keyframe. */
export function compExtent(comp: Composition): number {
  let max = comp.duration;
  for (const layer of comp.layers) {
    for (const track of layer.tracks) {
      const last = track.keyframes[track.keyframes.length - 1];
      if (last && last.time > max) max = last.time;
    }
  }
  return max;
}
