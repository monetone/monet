// ─────────────────────────────────────────────────────────────
// engine/ops/sample-rate — Adobe Audition–style Convert Sample Type ▸ Sample Rate
// ─────────────────────────────────────────────────────────────
// Convert a whole session to a different sample rate (e.g. 48 kHz → 44.1 kHz for
// a CD master). Every clip's source PCM is resampled to the new rate and the
// project's rate is updated; clip positions, in-points and durations are stored
// in seconds, so the timeline is untouched — only the underlying sample counts
// change. Pure and immutable (structural sharing): returns a new Project, never
// mutates the input.

import { resampleLinear } from "../audio/buffer";
import type { Project } from "../model/types";

/**
 * Resample every clip to `newRate` and set the project's sample rate. A no-op
 * (returns the same project) when `newRate` already matches.
 */
export function resampleProject(project: Project, newRate: number): Project {
  if (newRate <= 0) throw new Error("resampleProject: newRate must be > 0");
  if (newRate === project.sampleRate) return project;
  return {
    ...project,
    sampleRate: newRate,
    tracks: project.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((clip) => ({ ...clip, buffer: resampleLinear(clip.buffer, newRate) })),
    })),
  };
}
