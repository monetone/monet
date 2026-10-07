// ─────────────────────────────────────────────────────────────
// engine/ops/bounce — Bounce to New Track (Audition multitrack consolidation)
// ─────────────────────────────────────────────────────────────
// Audition's Multitrack ▸ Bounce to New Track renders a track (or the whole
// session) down to a single audio clip on a brand-new track, non-destructively
// (the sources are left untouched). Immutable: a new Project is returned, the
// same reference when there is nothing to bounce.

import type { AudioData } from "../audio/types";
import { newClip, newTrack } from "../model/factory";
import type { Project } from "../model/types";
import { renderProject } from "./render";

/** Append a new track whose single clip is `audio`, anchored at t=0. */
export function appendBouncedTrack(project: Project, audio: AudioData, name: string): Project {
  const track = newTrack(project.tracks.length, { name });
  const clip = newClip(audio, { trackId: track.id, start: 0, name });
  return { ...project, tracks: [...project.tracks, { ...track, clips: [clip] }] };
}

/** Bounce one track to a new track, baked through its full mixer strip — clip
 *  gain/fades AND the track's gain/pan/mute — but NOT the master fader (that
 *  belongs to the final mix). Renders a one-track projection so the result
 *  sounds exactly like the track does in the session. */
export function bounceTrackToNewTrack(project: Project, trackId: string): Project {
  const track = project.tracks.find((t) => t.id === trackId);
  if (!track) return project;
  const audio = renderProject({ ...project, tracks: [track] }, { applyMaster: false });
  return appendBouncedTrack(project, audio, `${track.name} (Bounced)`);
}

/** Bounce the entire session mix to a new track. Non-destructive: the source
 *  tracks are left audible (Audition parity), so mute/solo them as needed. */
export function bounceProjectToNewTrack(project: Project, name = "Session Mix (Bounced)"): Project {
  if (project.tracks.length === 0) return project;
  return appendBouncedTrack(project, renderProject(project), name);
}
