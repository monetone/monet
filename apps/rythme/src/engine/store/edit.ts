// ─────────────────────────────────────────────────────────────
// engine/store/edit — high-level edit commands (ops + selection)
// ─────────────────────────────────────────────────────────────
// Command creators that resolve the current selection into a concrete edit,
// run an engine/ops transform, and return new state. These are what the menus,
// toolbar and keyboard shortcuts dispatch.

import { durationSeconds, type AudioData } from "../audio/types";
import {
  applyGainDb,
  deClick,
  deClip,
  fadeIn,
  fadeOut,
  invertPolarity,
  normalizePeak,
  removeDcOffset,
  reverse,
  silence,
  spectralBrushGain,
  spectralGain,
  spectralHarmonicGain,
  type DeClipperOptions,
  type DeClickerOptions,
} from "../dsp";
import { newClip } from "../model/factory";
import type { EditorState, Project, TimeRange } from "../model/types";
import {
  addClip,
  applyEffectToClip,
  applyEffectToRange,
  applyEffectToTrack,
  copyRange,
  cutRange,
  deleteClip,
  deleteRange,
  duplicateClip,
  insertSilence,
  moveClip,
  pasteAt,
  setClipFades,
  splitAt,
  trimClipEdges,
  trimToRange,
  type FadeEdit,
  type SampleProcessor,
} from "../ops";
import type { Command } from "./store";

export type WaveformSampleEditKind =
  | "normalizePeak"
  | "removeDcOffset"
  | "reverse"
  | "invertPolarity"
  | "fadeIn"
  | "fadeOut"
  | "silence";
export type WaveformSilenceRepairMode = "remove" | "shorten";
export interface WaveformSilenceRepairPolicy {
  mode?: WaveformSilenceRepairMode;
  keepMs?: number;
}
export interface WaveformDiagnosticRepairOptions {
  clicks?: DeClickerOptions;
  silence?: WaveformSilenceRepairPolicy;
}
export interface WaveformSpectralHarmonicOptions {
  harmonics?: number;
  bandwidthHz?: number;
}
export interface WaveformSpectralBrushOptions {
  hardness?: number;
  frequencyHardness?: number;
}
export type WaveformDiagnosticRepairIssue = {
  kind: "clipping" | "click" | "dc-offset" | "silence";
  range: TimeRange;
};

function touch(p: Project): Project {
  return { ...p, meta: { ...p.meta, modified: Date.now() } };
}
function withProject(s: EditorState, p: Project): EditorState {
  return p === s.project ? s : { ...s, project: touch(p) };
}

/** Tracks the next edit should target: explicit selection → active → all. */
export function targetTrackIds(s: EditorState): string[] {
  if (s.selection.trackIds.length) return s.selection.trackIds;
  if (s.activeTrackId) return [s.activeTrackId];
  return s.project.tracks.map((t) => t.id);
}

// ── insertion ────────────────────────────────────────────────────────────────

/** Drop an audio buffer onto a track as a new clip at `atSeconds`. */
export const insertClip = (trackId: string, buffer: AudioData, atSeconds: number, name = "Clip"): Command => (s) => {
  const clip = newClip(buffer, { trackId, start: Math.max(0, atSeconds), name });
  return withProject(s, addClip(s.project, trackId, clip));
};

/** Drop the same recorded/imported buffer onto multiple tracks in one undoable edit. */
export const insertClipOnTracks = (trackIds: string[], buffer: AudioData, atSeconds: number, name = "Clip"): Command => (s) => {
  const valid = new Set(s.project.tracks.map((t) => t.id));
  const targets = [...new Set(trackIds)].filter((id) => valid.has(id));
  if (targets.length === 0) return s;
  let project = s.project;
  for (const trackId of targets) {
    project = addClip(project, trackId, newClip(buffer, { trackId, start: Math.max(0, atSeconds), name }));
  }
  return withProject(s, project);
};

/** Insert silence at the playhead across target tracks, pushing later clips. */
export const insertSilenceAtPlayhead = (duration: number): Command => (s) =>
  withProject(s, insertSilence(s.project, s.transport.playhead, duration, targetTrackIds(s)));

// ── structural edits ───────────────────────────────────────────────────────

/** Split clips at the playhead on target tracks (razor at cursor). */
export const splitAtPlayhead = (): Command => (s) =>
  withProject(s, splitAt(s.project, s.transport.playhead, targetTrackIds(s)));

/** Split clips at an arbitrary time. */
export const splitAtTime = (time: number, trackIds?: string[]): Command => (s) =>
  withProject(s, splitAt(s.project, time, trackIds ?? targetTrackIds(s)));

/** Move a clip to a new start time, optionally onto a different track. */
export const moveClipTo = (clipId: string, start: number, trackId?: string): Command => (s) =>
  withProject(s, moveClip(s.project, clipId, start, trackId));

/** Drag a clip's edges (head/tail trim). */
export const trimClipEdgesCmd = (clipId: string, leftDelta: number, rightDelta: number): Command => (s) =>
  withProject(s, trimClipEdges(s.project, clipId, leftDelta, rightDelta));

/** Set a clip's fades (used by the fade tool). */
export const setClipFadesCmd = (clipId: string, edit: FadeEdit): Command => (s) =>
  withProject(s, setClipFades(s.project, clipId, edit));

/** Duplicate a clip end-to-end. */
export const duplicateClipCmd = (clipId: string): Command => (s) =>
  withProject(s, duplicateClip(s.project, clipId));

/** Delete a single clip and deselect it. */
export const deleteClipCmd = (clipId: string): Command => (s) => ({
  ...withProject(s, deleteClip(s.project, clipId)),
  selection: { ...s.selection, clipIds: s.selection.clipIds.filter((id) => id !== clipId) },
});

/**
 * Delete the current selection: a range (rippling by default) or selected
 * clips. Clears the selection afterwards.
 */
export const deleteSelection = (ripple = true): Command => (s) => {
  if (s.selection.range) {
    const { start, end } = s.selection.range;
    const next = withProject(s, deleteRange(s.project, start, end, targetTrackIds(s), ripple));
    return { ...next, selection: { ...s.selection, range: ripple ? null : s.selection.range, spectral: null } };
  }
  if (s.selection.clipIds.length) {
    let proj = s.project;
    for (const id of s.selection.clipIds) proj = deleteClip(proj, id);
    return { ...withProject(s, proj), selection: { clipIds: [], trackIds: [], range: null, spectral: null } };
  }
  return s;
};

/** Replace the selected range with silence (non-rippling delete). */
export const silenceSelection = (): Command => (s) => {
  if (!s.selection.range) return s;
  const { start, end } = s.selection.range;
  const next = withProject(s, deleteRange(s.project, start, end, targetTrackIds(s), false));
  return { ...next, selection: { ...s.selection, spectral: null } };
};

/** Keep only the selected range, discarding everything outside it. */
export const trimToSelection = (): Command => (s) => {
  if (!s.selection.range) return s;
  const { start, end } = s.selection.range;
  const next = withProject(s, trimToRange(s.project, start, end, targetTrackIds(s)));
  return { ...next, selection: { ...s.selection, spectral: null } };
};

// ── clipboard ────────────────────────────────────────────────────────────────

export const copySelection = (): Command => (s) => {
  if (!s.selection.range) return s;
  const { start, end } = s.selection.range;
  return { ...s, clipboard: copyRange(s.project, start, end, targetTrackIds(s)) };
};

export const cutSelection = (): Command => (s) => {
  if (!s.selection.range) return s;
  const { start, end } = s.selection.range;
  const { project, clipboard } = cutRange(s.project, start, end, targetTrackIds(s));
  return { ...withProject(s, project), clipboard, selection: { ...s.selection, range: null, spectral: null } };
};

export const pasteAtPlayhead = (ripple = false): Command => (s) => {
  if (!s.clipboard) return s;
  return withProject(s, pasteAt(s.project, s.transport.playhead, s.clipboard, { ripple }));
};

/** Mix Paste: overlay the clipboard at the playhead (it sums with existing
 *  audio), optionally with a gain trim and/or phase inversion. */
export const mixPasteAtPlayhead = (opts: { gainDb?: number; invert?: boolean } = {}): Command => (s) => {
  if (!s.clipboard) return s;
  return withProject(s, pasteAt(s.project, s.transport.playhead, s.clipboard, opts));
};

// ── effects ──────────────────────────────────────────────────────────────────

/**
 * Apply a DSP processor to the current scope: the selected range across target
 * tracks, else the selected clips, else the whole active track.
 */
export const applyEffect = (fn: SampleProcessor): Command => (s) => {
  if (s.selection.range) {
    const { start, end } = s.selection.range;
    return withProject(s, applyEffectToRange(s.project, start, end, targetTrackIds(s), fn));
  }
  if (s.selection.clipIds.length) {
    let proj = s.project;
    for (const id of s.selection.clipIds) proj = applyEffectToClip(proj, id, fn);
    return withProject(s, proj);
  }
  if (s.activeTrackId) return withProject(s, applyEffectToTrack(s.project, s.activeTrackId, fn));
  return s;
};

/** Apply gain to the current rectangular spectral selection. */
export const applySpectralSelectionGain = (gainDb: number): Command => (s) => {
  const spectral = s.selection.spectral;
  if (!spectral || !Number.isFinite(gainDb)) return s;
  const { start, end } = spectral.time;
  const { minHz, maxHz } = spectral.frequency;
  if (end <= start || maxHz <= minHz) return s;
  return withProject(
    s,
    applyEffectToRange(s.project, start, end, targetTrackIds(s), (d) =>
      spectralGain(d, { minHz, maxHz, gainDb, channel: spectral.channel }),
    ),
  );
};

/** Apply a soft time-local spectral brush over the current spectral selection. */
export const applySpectralBrushSelectionGain = (gainDb: number, opts: WaveformSpectralBrushOptions = {}): Command => (s) => {
  const spectral = s.selection.spectral;
  if (!spectral || !Number.isFinite(gainDb)) return s;
  const { start, end } = spectral.time;
  const { minHz, maxHz } = spectral.frequency;
  if (end <= start || maxHz <= minHz) return s;

  return withProject(
    s,
    applyEffectToRange(s.project, start, end, targetTrackIds(s), (d) =>
      spectralBrushGain(d, {
        minHz,
        maxHz,
        gainDb,
        channel: spectral.channel,
        hardness: opts.hardness,
        frequencyHardness: opts.frequencyHardness,
      }),
    ),
  );
};

/** Apply gain to the selected fundamental band and its integer harmonics. */
export const applySpectralHarmonicSelectionGain = (gainDb: number, opts: WaveformSpectralHarmonicOptions = {}): Command => (s) => {
  const spectral = s.selection.spectral;
  if (!spectral || !Number.isFinite(gainDb)) return s;
  const { start, end } = spectral.time;
  const { minHz, maxHz } = spectral.frequency;
  if (end <= start || maxHz <= minHz) return s;

  const fundamentalHz = (minHz + maxHz) / 2;
  const bandwidthHz = opts.bandwidthHz ?? maxHz - minHz;
  const harmonics = opts.harmonics ?? 6;
  if (!Number.isFinite(fundamentalHz) || !Number.isFinite(bandwidthHz) || !Number.isFinite(harmonics)) return s;

  return withProject(
    s,
    applyEffectToRange(s.project, start, end, targetTrackIds(s), (d) =>
      spectralHarmonicGain(d, {
        fundamentalHz,
        bandwidthHz,
        harmonics,
        gainDb,
        channel: spectral.channel,
      }),
    ),
  );
};

/** Bake a Waveform-editor sample edit over an explicit or selected time range. */
export const applyWaveformSampleEdit = (
  kind: WaveformSampleEditKind,
  trackIds?: string[],
  rangeOverride?: TimeRange,
): Command => (s) => {
  const range = rangeOverride ?? s.selection.range;
  if (!range) return s;
  const start = Math.max(0, Math.min(range.start, range.end));
  const end = Math.max(start, Math.max(range.start, range.end));
  if (end <= start) return s;
  const valid = new Set(s.project.tracks.map((t) => t.id));
  const targets = (trackIds?.length ? trackIds : targetTrackIds(s)).filter((id) => valid.has(id));
  if (targets.length === 0) return s;
  const processor = waveformSampleProcessor(kind);
  const next = withProject(s, applyEffectToRange(s.project, start, end, targets, processor));
  return { ...next, selection: { ...s.selection, range: { start, end }, trackIds: targets, spectral: null } };
};

/** Apply an arbitrary gain trim over a Waveform-editor time range. */
export const applyWaveformRangeGain = (gainDb: number, trackIds?: string[], rangeOverride?: TimeRange): Command => (s) => {
  if (!Number.isFinite(gainDb)) return s;
  const range = rangeOverride ?? s.selection.range;
  if (!range) return s;
  const start = Math.max(0, Math.min(range.start, range.end));
  const end = Math.max(start, Math.max(range.start, range.end));
  if (end <= start) return s;
  const valid = new Set(s.project.tracks.map((t) => t.id));
  const targets = (trackIds?.length ? trackIds : targetTrackIds(s)).filter((id) => valid.has(id));
  if (targets.length === 0) return s;
  const next = withProject(s, applyEffectToRange(s.project, start, end, targets, (d) => applyGainDb(d, gainDb, true)));
  return { ...next, selection: { ...s.selection, range: { start, end }, trackIds: targets, spectral: null } };
};

/** Repair a waveform diagnostics clipping issue over an explicit timeline range. */
export const repairClippingRange = (range: TimeRange, trackIds?: string[], opts: DeClipperOptions = {}): Command => (s) => {
  const start = Math.max(0, Math.min(range.start, range.end));
  const end = Math.max(start, Math.max(range.start, range.end));
  if (end <= start) return s;
  const valid = new Set(s.project.tracks.map((t) => t.id));
  const targets = (trackIds?.length ? trackIds : targetTrackIds(s)).filter((id) => valid.has(id));
  if (targets.length === 0) return s;
  const next = withProject(s, applyEffectToRange(s.project, start, end, targets, (d) => deClip(d, opts)));
  return { ...next, selection: { ...s.selection, range: { start, end }, trackIds: targets, spectral: null } };
};

/** Repair a waveform diagnostics click/pop issue over an explicit timeline range. */
export const repairClickRange = (range: TimeRange, trackIds?: string[], opts: DeClickerOptions = {}): Command => (s) => {
  const start = Math.max(0, Math.min(range.start, range.end));
  const end = Math.max(start, Math.max(range.start, range.end));
  if (end <= start) return s;
  const valid = new Set(s.project.tracks.map((t) => t.id));
  const targets = (trackIds?.length ? trackIds : targetTrackIds(s)).filter((id) => valid.has(id));
  if (targets.length === 0) return s;
  const next = withProject(s, applyEffectToRange(s.project, start, end, targets, (d) => deClick(d, opts)));
  return { ...next, selection: { ...s.selection, range: { start, end }, trackIds: targets, spectral: null } };
};

/** Repair a waveform diagnostics DC-offset issue over an explicit timeline range. */
export const repairDcOffsetRange = (range: TimeRange, trackIds?: string[]): Command => (s) => {
  const start = Math.max(0, Math.min(range.start, range.end));
  const end = Math.max(start, Math.max(range.start, range.end));
  if (end <= start) return s;
  const valid = new Set(s.project.tracks.map((t) => t.id));
  const targets = (trackIds?.length ? trackIds : targetTrackIds(s)).filter((id) => valid.has(id));
  if (targets.length === 0) return s;
  const next = withProject(s, applyEffectToRange(s.project, start, end, targets, removeDcOffset));
  return { ...next, selection: { ...s.selection, range: { start, end }, trackIds: targets, spectral: null } };
};

/** Repair a waveform diagnostics silence issue by removing or shortening that silent range. */
export const repairSilenceRange = (range: TimeRange, trackIds?: string[], policy: WaveformSilenceRepairPolicy = {}): Command => (s) => {
  const start = Math.max(0, Math.min(range.start, range.end));
  const end = Math.max(start, Math.max(range.start, range.end));
  if (end <= start) return s;
  const valid = new Set(s.project.tracks.map((t) => t.id));
  const targets = (trackIds?.length ? trackIds : targetTrackIds(s)).filter((id) => valid.has(id));
  if (targets.length === 0) return s;
  const repairRange = silenceRepairDeleteRange(start, end, policy);
  if (!repairRange) return s;
  const next = withProject(s, deleteRange(s.project, repairRange.start, repairRange.end, targets, true));
  return { ...next, selection: { ...s.selection, range: null, trackIds: targets, spectral: null } };
};

/** Repair all scanned waveform diagnostics in one undoable project edit. */
export const repairDiagnosticIssues = (
  issues: WaveformDiagnosticRepairIssue[],
  trackIds?: string[],
  clippingOpts: DeClipperOptions = {},
  repairOpts: WaveformDiagnosticRepairOptions = {},
): Command => (s) => {
  const valid = new Set(s.project.tracks.map((t) => t.id));
  const targets = (trackIds?.length ? trackIds : targetTrackIds(s)).filter((id) => valid.has(id));
  if (targets.length === 0) return s;

  const normalized = issues
    .map((issue) => {
      const start = Math.max(0, Math.min(issue.range.start, issue.range.end));
      const end = Math.max(start, Math.max(issue.range.start, issue.range.end));
      return end > start ? { kind: issue.kind, start, end } : null;
    })
    .filter((issue): issue is { kind: "clipping" | "click" | "dc-offset" | "silence"; start: number; end: number } => !!issue)
    .sort((a, b) => b.start - a.start || b.end - a.end || diagnosticRepairRank(a.kind) - diagnosticRepairRank(b.kind));
  if (normalized.length === 0) return s;

  let project = s.project;
  for (const issue of normalized) {
    if (issue.kind === "clipping") {
      project = applyEffectToRange(project, issue.start, issue.end, targets, (d) => deClip(d, clippingOpts));
    } else if (issue.kind === "click") {
      project = applyEffectToRange(project, issue.start, issue.end, targets, (d) => deClick(d, repairOpts.clicks));
    } else if (issue.kind === "dc-offset") {
      project = applyEffectToRange(project, issue.start, issue.end, targets, removeDcOffset);
    } else {
      const repairRange = silenceRepairDeleteRange(issue.start, issue.end, repairOpts.silence);
      if (repairRange) project = deleteRange(project, repairRange.start, repairRange.end, targets, true);
    }
  }
  const next = withProject(s, project);
  return { ...next, selection: { ...s.selection, range: null, trackIds: targets, spectral: null } };
};

function waveformSampleProcessor(kind: WaveformSampleEditKind): SampleProcessor {
  switch (kind) {
    case "normalizePeak":
      return (d) => normalizePeak(d, -0.3);
    case "removeDcOffset":
      return removeDcOffset;
    case "reverse":
      return reverse;
    case "invertPolarity":
      return invertPolarity;
    case "fadeIn":
      return (d) => fadeIn(d, durationSeconds(d));
    case "fadeOut":
      return (d) => fadeOut(d, durationSeconds(d));
    case "silence":
      return silence;
  }
}

function diagnosticRepairRank(kind: "clipping" | "click" | "dc-offset" | "silence"): number {
  if (kind === "clipping") return 0;
  if (kind === "click") return 1;
  if (kind === "dc-offset") return 2;
  return 3;
}

function silenceRepairDeleteRange(start: number, end: number, policy: WaveformSilenceRepairPolicy = {}): TimeRange | null {
  if (end <= start) return null;
  if (policy.mode !== "shorten") return { start, end };
  const keepSeconds = Math.max(0, Math.min(end - start, (Number.isFinite(policy.keepMs) ? policy.keepMs! : 100) / 1000));
  const deleteStart = Math.min(end, start + keepSeconds);
  return end > deleteStart ? { start: deleteStart, end } : null;
}
