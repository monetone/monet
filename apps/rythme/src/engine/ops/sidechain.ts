// ─────────────────────────────────────────────────────────────
// engine/ops/sidechain — apply a two-input (keyed) effect across tracks
// ─────────────────────────────────────────────────────────────
// The sidechain DSP processors duck/compress one buffer by another, but a
// track's audio is a timeline of positioned clips. applyKeyedEffect renders the
// key track and the target track over the SAME timeline (so they are
// sample-aligned), runs the processor, and bakes the result back as a single
// clip — the destructive "bounce" a multitrack keyed process produces.
// Immutable: a new Project is returned.

import { newClip } from "../model/factory";
import type { Project } from "../model/types";
import type { AudioData } from "../audio/types";
import { sidechainDuck, type SidechainDuckOptions } from "../dsp/sidechain-duck";
import { sidechainCompress, type SidechainCompressOptions } from "../dsp/sidechain-compress";
import { sidechainGate, type SidechainGateOptions } from "../dsp/sidechain-gate";
import { renderTrack } from "./render";

/**
 * Render `targetTrackId` and `keyTrackId` over the timeline, run `process` with
 * the (aligned) target and key buffers, and replace the target track's clips
 * with one clip at t = 0. No-op if a track is missing or they are the same.
 */
export function applyKeyedEffect(
  project: Project,
  targetTrackId: string,
  keyTrackId: string,
  process: (target: AudioData, key: AudioData) => AudioData,
  clipName = "Keyed",
): Project {
  if (targetTrackId === keyTrackId) return project;
  const target = project.tracks.find((t) => t.id === targetTrackId);
  const key = project.tracks.find((t) => t.id === keyTrackId);
  if (!target || !key) return project;

  const sr = project.sampleRate;
  const baked = process(renderTrack(target, sr, 2), renderTrack(key, sr, 2));
  const clip = newClip(baked, { trackId: targetTrackId, start: 0, name: clipName });

  return {
    ...project,
    tracks: project.tracks.map((t) => (t.id === targetTrackId ? { ...t, clips: [clip] } : t)),
  };
}

/** Auto-duck `targetTrackId` by `keyTrackId` (Essential Sound ▸ Ducking). */
export function duckTrack(project: Project, targetTrackId: string, keyTrackId: string, opts: SidechainDuckOptions = {}): Project {
  return applyKeyedEffect(project, targetTrackId, keyTrackId, (t, k) => sidechainDuck(t, k, opts), "Ducked");
}

/** Sidechain-compress `targetTrackId` keyed by `keyTrackId` (the "pumping" effect). */
export function sidechainCompressTrack(
  project: Project,
  targetTrackId: string,
  keyTrackId: string,
  opts: SidechainCompressOptions = {},
): Project {
  return applyKeyedEffect(project, targetTrackId, keyTrackId, (t, k) => sidechainCompress(t, k, opts), "Compressed");
}

/** Sidechain-gate `targetTrackId` keyed by `keyTrackId` — audible only while the key plays. */
export function sidechainGateTrack(
  project: Project,
  targetTrackId: string,
  keyTrackId: string,
  opts: SidechainGateOptions = {},
): Project {
  return applyKeyedEffect(project, targetTrackId, keyTrackId, (t, k) => sidechainGate(t, k, opts), "Gated");
}
