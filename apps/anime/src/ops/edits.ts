// ops/edits — pure, mutate-in-place editing ops. Always call inside store.mutate
// (which clones the project), so these never need to clone themselves.

import { newId } from "../model/ids";
import type { AnimTrack, Composition, Keyframe, Layer, TrackProperty } from "../model/types";

const EPS = 1e-4; // seconds — keyframes within this of each other are "the same time"

export function sortKeyframes(track: AnimTrack): void {
  track.keyframes.sort((a, b) => a.time - b.time);
}

/** Insert a keyframe, replacing any existing one at (≈) the same time. */
export function upsertKeyframe(track: AnimTrack, kf: Keyframe): void {
  const i = track.keyframes.findIndex((k) => Math.abs(k.time - kf.time) <= EPS);
  if (i >= 0) track.keyframes[i] = { ...kf, id: track.keyframes[i].id };
  else track.keyframes.push(kf);
  sortKeyframes(track);
}

export function removeKeyframe(track: AnimTrack, kfId: string): void {
  track.keyframes = track.keyframes.filter((k) => k.id !== kfId);
}

/** Find or create the track for a layer property. */
export function getOrCreateTrack(layer: Layer, property: TrackProperty): AnimTrack {
  let track = layer.tracks.find((t) => t.property === property);
  if (!track) {
    track = { id: newId("track"), property, keyframes: [] };
    layer.tracks.push(track);
  }
  return track;
}

export function removeTrack(layer: Layer, property: TrackProperty): void {
  layer.tracks = layer.tracks.filter((t) => t.property !== property);
}

// ── layer stacking ────────────────────────────────────────────
/** Add a layer to the front (top) of the composition. */
export function addLayerFront(comp: Composition, layer: Layer): void {
  comp.layers.unshift(layer);
}

export function removeLayer(comp: Composition, id: string): void {
  comp.layers = comp.layers.filter((l) => l.id !== id);
}

/** Move a layer to a new index (clamped), preserving the rest of the order. */
export function moveLayer(comp: Composition, id: string, toIndex: number): void {
  const from = comp.layers.findIndex((l) => l.id === id);
  if (from < 0) return;
  const [layer] = comp.layers.splice(from, 1);
  const clamped = Math.max(0, Math.min(comp.layers.length, toIndex));
  comp.layers.splice(clamped, 0, layer);
}
