// ─────────────────────────────────────────────────────────────
// engine/ops/crossfade — multitrack clip crossfades
// ─────────────────────────────────────────────────────────────
// Audition's multitrack Crossfade: when two clips on a lane overlap, the earlier
// one fades out and the later one fades in across the overlap so the seam is
// smooth instead of a hard sum. We implement it with the clips' own fade curves
// (renderClip already applies them): set the earlier clip's fadeOut and the
// later clip's fadeIn to the overlap length, aligned to the same time window.
//
// The default equal-power (sin/cos) curve keeps POWER constant across the seam
// for uncorrelated material (no level dip); a linear curve keeps AMPLITUDE
// constant for correlated material (e.g. the same take). Immutable.

import { clipById, clipEnd } from "../model/query";
import type { Clip, FadeShape, Project } from "../model/types";

export interface CrossfadeOptions {
  /** Crossfade curve. Default "equalPower" (constant power, Audition's default). */
  shape?: FadeShape;
}

/**
 * Crossfade two overlapping clips on the same track. The earlier clip gets a
 * fade-out and the later clip a fade-in over their overlap. No-op if either clip
 * is missing, they are on different tracks, or they do not overlap.
 */
export function crossfadeClips(project: Project, clipAId: string, clipBId: string, opts: CrossfadeOptions = {}): Project {
  const a = clipById(project, clipAId);
  const b = clipById(project, clipBId);
  if (!a || !b || a.track.id !== b.track.id || clipAId === clipBId) return project;

  let earlier = a.clip;
  let later = b.clip;
  if (earlier.start > later.start) [earlier, later] = [later, earlier];

  const overlap = clipEnd(earlier) - later.start;
  if (overlap <= 0) return project;
  const xf = Math.min(overlap, earlier.duration, later.duration);
  const shape = opts.shape ?? "equalPower";

  return {
    ...project,
    tracks: project.tracks.map((t) =>
      t.id !== earlier.trackId
        ? t
        : {
            ...t,
            clips: t.clips.map((c): Clip => {
              if (c.id === earlier.id) return { ...c, fadeOut: xf, fadeOutShape: shape };
              if (c.id === later.id) return { ...c, fadeIn: xf, fadeInShape: shape };
              return c;
            }),
          },
    ),
  };
}

/**
 * Auto-crossfade every adjacent overlapping pair of clips on a track, in
 * timeline order. No-op for a missing track.
 */
export function autoCrossfadeTrack(project: Project, trackId: string, opts: CrossfadeOptions = {}): Project {
  const track = project.tracks.find((t) => t.id === trackId);
  if (!track) return project;
  const ordered = [...track.clips].sort((x, y) => x.start - y.start);
  let p = project;
  for (let i = 0; i < ordered.length - 1; i++) {
    if (clipEnd(ordered[i]) - ordered[i + 1].start > 0) p = crossfadeClips(p, ordered[i].id, ordered[i + 1].id, opts);
  }
  return p;
}
