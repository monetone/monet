// ─────────────────────────────────────────────────────────────
// autokey.ts — Unity's Animation "Record" mode, as a pure op. While recording,
// editing a transform creates/updates keyframes for the changed properties at
// the current playhead. This module holds the framework-free core: given a
// timeline, the (already-edited) object, the changed track properties and a
// time, it upserts a keyframe per property — creating the (object, property)
// track if needed. The command layer calls it inside the same undo step as the
// edit. No React/Phaser/store.
// ─────────────────────────────────────────────────────────────

import type { GameObject, Timeline, TrackProperty } from "../model/types";
import { createTrack, createKeyframe } from "../model/factory";
import { readProperty } from "../model/query";
import { upsertKeyframe } from "./edits";

/** Transform properties that record mode can auto-key (the keyable subset of
 *  Transform), in a stable order. */
export const TRANSFORM_TRACK_PROPS: TrackProperty[] = [
  "x",
  "y",
  "scaleX",
  "scaleY",
  "angle",
  "alpha",
  "originX",
  "originY",
];

/** The keys of a transform patch that are keyable track properties (stable
 *  order). Used to auto-key exactly the properties an edit changed. */
export function transformTrackProps(patch: object): TrackProperty[] {
  return TRANSFORM_TRACK_PROPS.filter((p) => p in patch);
}

/** Auto-key (Unity "Record"): upsert a keyframe for each property in `props`
 *  on `tl` for `obj` at `time`, reading the object's current value. Reuses an
 *  existing (obj, prop) track or creates one. Mutates `tl`. */
export function autoKeyTracks(tl: Timeline, obj: GameObject, props: TrackProperty[], time: number): void {
  for (const p of props) {
    let track = tl.tracks.find((t) => t.targetId === obj.id && t.property === p);
    if (track?.locked) continue; // record mode can't auto-key a locked track (Unity Timeline lock)
    if (!track) {
      track = createTrack(obj.id, p);
      tl.tracks.push(track);
    }
    upsertKeyframe(track, createKeyframe(time, readProperty(obj, p)));
  }
}
