// ─────────────────────────────────────────────────────────────
// engine/ops/batch-export — render/encode multiple deliverables
// ─────────────────────────────────────────────────────────────
// Audition's batch/export workflows produce a set of separate files: stems,
// marker regions, or selected clips. Keep this pure: callers decide whether to
// download the files, write them through a native save panel, or expose them via
// MCP automation.

import { channelCount, durationSeconds, frameCount, type AudioData } from "../audio/types";
import { applyGainDb } from "../dsp/gain";
import { hardLimiter, type HardLimiterOptions } from "../dsp/limiter";
import { matchLoudness, type MatchLoudnessOptions } from "../dsp/loudness-match";
import { normalizePeak, normalizeRMS } from "../dsp/normalize";
import { encodeAiff, type AiffEncodeOptions } from "../io/aiff";
import { markersInRange } from "../io/markers";
import { projectMetaToAudioMetadata } from "../io/metadata";
import { encodeWav, type WavBitDepth } from "../io/wav";
import { clipById, projectDuration, sortedMarkers } from "../model/query";
import type { Marker, Project } from "../model/types";
import { renderClip, renderProject, renderProjectRange } from "./render";

export type BatchExportFormat = "wav" | "aiff";
export type BatchExportKind = "track" | "region" | "clip";

export type BatchExportScope =
  | { kind: "tracks"; trackIds?: string[] }
  | { kind: "regions"; markerIds?: string[] }
  | { kind: "clips"; clipIds: string[] };

export interface BatchExportRenderItem {
  kind: BatchExportKind;
  sourceId: string;
  name: string;
  audio: AudioData;
  markers?: { time: number; name?: string }[];
}

export interface BatchExportEncodeOptions {
  format?: BatchExportFormat;
  bitDepth?: 16 | 24 | 32;
  /** WAV only; writes 32-bit IEEE float. */
  float?: boolean;
  /** Optional per-file process chain applied after rendering and before encoding. */
  processing?: BatchProcessStep[];
}

export type BatchProcessStep =
  | { kind: "gain"; gainDb: number }
  | { kind: "normalizePeak"; targetDb?: number }
  | { kind: "normalizeRms"; targetDb?: number }
  | ({ kind: "hardLimiter" } & HardLimiterOptions)
  | ({ kind: "matchLoudness" } & MatchLoudnessOptions);

export interface BatchExportFile {
  kind: BatchExportKind;
  sourceId: string;
  name: string;
  mime: string;
  bytes: Uint8Array;
  duration: number;
  channels: number;
}

/** Render the requested batch scope into independent audio items. */
export function renderBatchExports(project: Project, scope: BatchExportScope): BatchExportRenderItem[] {
  switch (scope.kind) {
    case "tracks":
      return renderTrackStems(project, scope.trackIds);
    case "regions":
      return renderMarkerRegions(project, scope.markerIds);
    case "clips":
      return renderSelectedClips(project, scope.clipIds);
  }
}

/** Render and encode the requested batch scope as named downloadable files. */
export function encodeBatchExports(
  project: Project,
  scope: BatchExportScope,
  opts: BatchExportEncodeOptions = {},
): BatchExportFile[] {
  return renderBatchExports(project, scope).map((item) => encodeBatchExport(project, item, opts));
}

/** Apply an Audition-style batch process chain to one rendered deliverable. */
export function processBatchAudio(audio: AudioData, steps: readonly BatchProcessStep[] = []): AudioData {
  let out = audio;
  for (const step of steps) {
    switch (step.kind) {
      case "gain":
        out = Number.isFinite(step.gainDb) && step.gainDb !== 0 ? applyGainDb(out, step.gainDb) : out;
        break;
      case "normalizePeak":
        out = normalizePeak(out, finiteOr(step.targetDb, -0.3));
        break;
      case "normalizeRms":
        out = normalizeRMS(out, finiteOr(step.targetDb, -20));
        break;
      case "hardLimiter":
        out = hardLimiter(out, step);
        break;
      case "matchLoudness":
        out = matchLoudness(out, step);
        break;
    }
  }
  return out;
}

function renderTrackStems(project: Project, trackIds?: string[]): BatchExportRenderItem[] {
  const allowed = trackIds?.length ? new Set(trackIds) : null;
  const duration = projectDuration(project);
  const items = project.tracks
    .filter((track) => !allowed || allowed.has(track.id))
    .map((track) => ({
      kind: "track" as const,
      sourceId: track.id,
      name: `${project.name} - ${track.name}`,
      audio: renderProject({ ...project, tracks: [track] }, { applyMaster: false, durationSeconds: duration }),
    }));
  return uniquifyItemNames(items);
}

function renderMarkerRegions(project: Project, markerIds?: string[]): BatchExportRenderItem[] {
  const allowed = markerIds?.length ? new Set(markerIds) : null;
  const regions = sortedMarkers(project).filter((m) => isRegion(m) && (!allowed || allowed.has(m.id)));
  const items = regions.map((marker) => ({
    kind: "region" as const,
    sourceId: marker.id,
    name: `${project.name} - ${marker.name}`,
    audio: renderProjectRange(project, marker.time, marker.end!),
    markers: markersInRange(project.markers, marker.time, marker.end!),
  }));
  return uniquifyItemNames(items);
}

function renderSelectedClips(project: Project, clipIds: string[]): BatchExportRenderItem[] {
  const seen = new Set<string>();
  const items: BatchExportRenderItem[] = [];
  for (const id of clipIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const found = clipById(project, id);
    if (!found) continue;
    items.push({
      kind: "clip",
      sourceId: id,
      name: `${project.name} - ${found.track.name} - ${found.clip.name}`,
      audio: renderClip(found.clip),
    });
  }
  return uniquifyItemNames(items);
}

function encodeBatchExport(
  project: Project,
  item: BatchExportRenderItem,
  opts: BatchExportEncodeOptions,
): BatchExportFile {
  const format = opts.format ?? "wav";
  const base = safeFileBase(item.name);
  const audio = opts.processing?.length ? processBatchAudio(item.audio, opts.processing) : item.audio;
  const processedItem = audio === item.audio ? item : { ...item, audio };
  if (format === "aiff") {
    const bitDepth = normalizeAiffBitDepth(opts.bitDepth);
    const bytes = encodeAiff(audio, {
      bitDepth,
      markers: item.markers,
      metadata: projectMetaToAudioMetadata(project.meta, project.name),
    });
    return fileRecord(processedItem, `${base}.aiff`, "audio/aiff", bytes);
  }

  const float = opts.float ?? false;
  const bitDepth = normalizeWavBitDepth(opts.bitDepth ?? (float ? 32 : 24), float);
  const bytes = encodeWav(audio, {
    bitDepth,
    float,
    markers: item.markers,
    metadata: projectMetaToAudioMetadata(project.meta, project.name),
  });
  return fileRecord(processedItem, `${base}.wav`, "audio/wav", bytes);
}

function fileRecord(item: BatchExportRenderItem, name: string, mime: string, bytes: Uint8Array): BatchExportFile {
  return {
    kind: item.kind,
    sourceId: item.sourceId,
    name,
    mime,
    bytes,
    duration: durationSeconds(item.audio),
    channels: channelCount(item.audio),
  };
}

function normalizeWavBitDepth(bitDepth: number, float: boolean): WavBitDepth {
  if (float) return 32;
  return bitDepth === 16 || bitDepth === 24 || bitDepth === 32 ? bitDepth : 24;
}

function normalizeAiffBitDepth(bitDepth: number | undefined): AiffEncodeOptions["bitDepth"] {
  return bitDepth === 16 || bitDepth === 24 || bitDepth === 32 ? bitDepth : 24;
}

function isRegion(marker: Marker): marker is Marker & { end: number } {
  return marker.end != null && marker.end > marker.time;
}

function safeFileBase(name: string): string {
  const clean = name
    // Stripping control characters out of a filename is the point of this class.
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+|\.+$/g, "");
  return (clean || "export").slice(0, 140);
}

function finiteOr(value: number | undefined, fallback: number): number {
  return value != null && Number.isFinite(value) ? value : fallback;
}

function uniquifyItemNames<T extends BatchExportRenderItem>(items: T[]): T[] {
  const used = new Map<string, number>();
  return items.map((item) => {
    const base = safeFileBase(item.name);
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    return count === 0 ? { ...item, name: base } : { ...item, name: `${base} ${count + 1}` };
  });
}

/** Cheap guard for UI/MCP summaries. */
export function batchExportItemFrames(items: BatchExportRenderItem[]): number {
  return items.reduce((sum, item) => sum + frameCount(item.audio), 0);
}
