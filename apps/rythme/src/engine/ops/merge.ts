// ─────────────────────────────────────────────────────────────
// engine/ops/merge — merge (join) clips into one
// ─────────────────────────────────────────────────────────────
// Audition's multitrack "Merge Clips" — the inverse of Split: render the
// selected clips (which must share a track) into a single clip spanning from the
// earliest start to the latest end. Each clip is mixed in at its position
// relative to that span, so adjacent clips concatenate and overlaps sum, exactly
// as they sound. The selected clips are replaced by the one merged clip.
// Immutable: a new Project is returned (the same reference when there's nothing
// to merge — fewer than two clips, or clips on different tracks).

import { createAudioData, mixInto, resampleLinear } from "../audio/buffer";
import { newClip } from "../model/factory";
import { clipById, clipEnd } from "../model/query";
import type { Clip, Project } from "../model/types";
import { renderClip } from "./render";

/** Merge `clipIds` (all on one track) into a single rendered clip. */
export function mergeClips(project: Project, clipIds: string[]): Project {
  const found = clipIds.map((id) => clipById(project, id)).filter((x): x is NonNullable<typeof x> => x != null);
  if (found.length < 2) return project;
  const trackId = found[0].track.id;
  if (!found.every((f) => f.track.id === trackId)) return project;

  const clips = found.map((f) => f.clip);
  const sr = project.sampleRate;
  const minStart = Math.min(...clips.map((c) => c.start));
  const maxEnd = Math.max(...clips.map((c) => clipEnd(c)));
  const frames = Math.round((maxEnd - minStart) * sr);
  if (frames <= 0) return project;

  const merged = createAudioData(2, frames, sr);
  for (const clip of clips) {
    let audio = renderClip(clip);
    if (audio.sampleRate !== sr) audio = resampleLinear(audio, sr);
    mixInto(merged, audio, Math.round((clip.start - minStart) * sr)); // sums overlaps, places at the relative offset
  }
  const joined = newClip(merged, { trackId, start: minStart, name: "Merged" });

  const removed = new Set(clipIds);
  return {
    ...project,
    tracks: project.tracks.map((t): typeof t =>
      t.id !== trackId
        ? t
        : { ...t, clips: [...t.clips.filter((c: Clip) => !removed.has(c.id)), joined].sort((a, b) => a.start - b.start) },
    ),
  };
}
