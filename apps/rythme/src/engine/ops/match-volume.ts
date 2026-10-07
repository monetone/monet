// ─────────────────────────────────────────────────────────────
// engine/ops/match-volume — Audition "Match Clip Volume"
// ─────────────────────────────────────────────────────────────
// Bring a set of clips to a common level by setting each clip's gain trim — the
// non-destructive multitrack "Match Clip Volume" (a quiet take comes up to a
// loud one without re-rendering the audio). Each clip's source level is measured
// at unity (Peak, total RMS, or ITU-R BS.1770 Loudness); the gain that lands it
// on the target is stored in clip.gainDb. The target defaults to the loudest
// clip in the set, so nothing clips. Immutable: a new Project is returned.

import { sliceFrames } from "../audio/buffer";
import { gainToDb } from "../audio/db";
import { frameCount, type AudioData } from "../audio/types";
import { peakAmplitude, rmsAmplitude } from "../dsp/normalize";
import { measureLoudness } from "../analysis/loudness";
import { clipById } from "../model/query";
import type { Clip, Project } from "../model/types";

export type MatchVolumeMode = "peak" | "rms" | "loudness";

export interface MatchVolumeOptions {
  /** What to equalise: sample Peak, total RMS, or integrated Loudness. Default "peak". */
  mode?: MatchVolumeMode;
  /** Target level (dBFS for peak/rms, LUFS for loudness). Default: the loudest clip in the set. */
  targetDb?: number;
}

const MAX_TRIM_DB = 48;

/** The clip's audible source region at unity gain (no clip gain/fades applied). */
function clipBody(clip: Clip): AudioData {
  const sr = clip.buffer.sampleRate;
  const start = Math.round(clip.inPoint * sr);
  return sliceFrames(clip.buffer, start, start + Math.round(clip.duration * sr));
}

/** Measured level of a clip's source in the requested mode (dBFS, or LUFS for
 *  loudness); −Infinity when the clip is silent / un-measurable. */
function clipLevelDb(clip: Clip, mode: MatchVolumeMode): number {
  const body = clipBody(clip);
  if (frameCount(body) === 0) return -Infinity;
  if (mode === "loudness") {
    const lufs = measureLoudness(body).integrated;
    return Number.isFinite(lufs) ? lufs : -Infinity;
  }
  const linear = mode === "rms" ? rmsAmplitude(body) : peakAmplitude(body);
  return linear > 1e-9 ? gainToDb(linear) : -Infinity; // guard true silence (gainToDb floors, not −∞)
}

/**
 * Set each of `clipIds`' gain so its level matches the target. Clips that don't
 * exist or are silent (un-measurable) are left untouched; a no-op set returns the
 * same project reference.
 */
export function matchClipVolume(project: Project, clipIds: string[], opts: MatchVolumeOptions = {}): Project {
  const mode = opts.mode ?? "peak";
  const levels = new Map<string, number>();
  for (const id of clipIds) {
    const found = clipById(project, id);
    if (found) levels.set(id, clipLevelDb(found.clip, mode));
  }
  const finite = [...levels.values()].filter((v) => Number.isFinite(v));
  if (finite.length === 0) return project;
  const target = opts.targetDb ?? Math.max(...finite);

  let changed = false;
  const tracks = project.tracks.map((t) => ({
    ...t,
    clips: t.clips.map((c): Clip => {
      const level = levels.get(c.id);
      if (level === undefined || !Number.isFinite(level)) return c;
      const gainDb = Math.max(-MAX_TRIM_DB, Math.min(MAX_TRIM_DB, target - level));
      if (gainDb === c.gainDb) return c;
      changed = true;
      return { ...c, gainDb };
    }),
  }));
  return changed ? { ...project, tracks } : project;
}
