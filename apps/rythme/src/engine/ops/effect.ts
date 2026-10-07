// ─────────────────────────────────────────────────────────────
// engine/ops/effect — destructively bake a DSP processor into clips
// ─────────────────────────────────────────────────────────────
// A processor is any `(AudioData) => AudioData` from engine/dsp. Applying it to
// a clip bakes the clip's audible audio (gain + fades already rendered) through
// the processor and stores the result as the new source, resetting gain/fades.
// Applying to a time range splits at the boundaries and bakes each clip inside.

import { durationSeconds, type AudioData } from "../audio/types";
import { clipById, clipEnd } from "../model/query";
import type { Clip, Project } from "../model/types";
import { renderClip } from "./render";
import { splitAt } from "./clip";

export type SampleProcessor = (d: AudioData) => AudioData;

const EPS = 1e-9;

/** Bake a processor into a single clip. */
export function applyEffectToClip(p: Project, clipId: string, fn: SampleProcessor): Project {
  const found = clipById(p, clipId);
  if (!found) return p;
  const baked = fn(renderClip(found.clip));
  const next: Clip = {
    ...found.clip,
    buffer: baked,
    inPoint: 0,
    duration: durationSeconds(baked),
    gainDb: 0,
    fadeIn: 0,
    fadeOut: 0,
  };
  return {
    ...p,
    tracks: p.tracks.map((t) =>
      t.id !== found.track.id ? t : { ...t, clips: t.clips.map((c) => (c.id === clipId ? next : c)) },
    ),
  };
}

/** Bake a processor into every clip inside [start, end) on the given tracks. */
export function applyEffectToRange(
  p: Project,
  start: number,
  end: number,
  trackIds: string[] | undefined,
  fn: SampleProcessor,
): Project {
  if (end <= start) return p;
  let proj = splitAt(splitAt(p, start, trackIds), end, trackIds);
  const set = trackIds ? new Set(trackIds) : null;
  const ids: string[] = [];
  for (const t of proj.tracks) {
    if (set && !set.has(t.id)) continue;
    for (const c of t.clips) if (c.start >= start - EPS && clipEnd(c) <= end + EPS) ids.push(c.id);
  }
  for (const id of ids) proj = applyEffectToClip(proj, id, fn);
  return proj;
}

/** Bake a processor into every clip on a whole track. */
export function applyEffectToTrack(p: Project, trackId: string, fn: SampleProcessor): Project {
  const track = p.tracks.find((t) => t.id === trackId);
  if (!track) return p;
  let proj = p;
  for (const c of track.clips) proj = applyEffectToClip(proj, c.id, fn);
  return proj;
}
