// ─────────────────────────────────────────────────────────────
// monet-adapter.ts — map Cinema's Project ⇆ the universal `.monet` document
// (@monet-ui/monet-format). Cinema's per-clip domain payload (transform/color/
// effects/transitions/audio) rides in the namespaced `data.cinema` bag; the
// timing backbone (start/duration/inPoint/speed/enabled) is shared. Sequences
// use a frames timeBase. On load, a seconds-based sequence (a Rythme `.monet`)
// is converted to frames first, so Cinema can cross-open any Monet project.
//
// COURIER: Cinema owns `data.cinema` and nothing else. Every foreign
// `data.<app>` namespace, every unowned field (a media `source.embed` holding
// Rythme's PCM, a marker's region `end`, a sequence's sampleRate/tempo) and any
// unknown forward-compat key rides along on the model as opaque `foreign` cargo
// and is re-emitted verbatim on save — so a Rythme document keeps its
// effectRack/automation/sends/surroundPan through a Cinema round-trip.
// ─────────────────────────────────────────────────────────────

import {
  type DataBag,
  type MonetClip,
  type MonetDocument,
  type MonetFile,
  type MonetMedia,
  type MonetMarker,
  type MonetSequence,
  type MonetTrack,
  convertSequenceTimeBase,
  createFile,
  getData,
} from "@monet-ui/monet-format";
import { sanitizeClipLut } from "../../state/effects";
import { defaultColorGrade, defaultTransform } from "../model/factory";
import type {
  Clip,
  ClipKind,
  ColorGrade,
  Effect,
  ForeignPayload,
  Marker,
  MediaItem,
  Project,
  Sequence,
  Track,
  Transform,
  Transition,
} from "../model/types";
import { SCHEMA_ID } from "../model/types";

/** Who wrote the document (and the container around it) last. */
export const CINEMA_APP = { name: "monet-cinema" as const, version: "0.1.0" };
/** Our data-bag namespace — the only key in any `data` bag Cinema may rewrite. */
const NS = "cinema";

/** The Cinema clip payload stored under `data.cinema`. */
interface CinemaClipData {
  kind: ClipKind;
  transform: Transform;
  color: ColorGrade;
  effects: Effect[];
  audioGain: number;
  fadeInFrames: number;
  fadeOutFrames: number;
  transitionIn?: Transition;
  transitionOut?: Transition;
  linkedId?: string;
  label?: string;
}

interface CinemaTrackData {
  muted: boolean;
  solo: boolean;
  height: number;
  gain: number;
}

// ── Courier plumbing ──────────────────────────────────────────
// ponytail: these three helpers are duplicated in every app's adapter (see
// apps/anime/src/io/monet-adapter.ts). Hoist them into @monet-ui/monet-format
// once a fourth app needs them — they are ~10 lines and the package is shared.

/** Everything in a `data` bag except our namespace — i.e. other apps' payload. */
function foreignData(data: DataBag | undefined): DataBag | undefined {
  if (!data) return undefined;
  const { [NS]: _mine, ...rest } = data;
  return Object.keys(rest).length > 0 ? rest : undefined;
}

/** Park unowned fields + foreign namespaces as cargo; `undefined` if nothing to carry. */
function cargo(unowned: ForeignPayload, foreign: DataBag | undefined): ForeignPayload | undefined {
  const out: ForeignPayload = { ...unowned, ...(foreign ? { data: foreign } : {}) };
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Merge our namespace back into a carried `data` bag; `undefined` if empty. */
function withData(src: { data?: DataBag }, mine: unknown): DataBag | undefined {
  const out: DataBag = { ...(src.data ?? {}), ...(mine !== undefined ? { [NS]: mine } : {}) };
  return Object.keys(out).length > 0 ? out : undefined;
}

// ── Project → MonetFile ───────────────────────────────────────
export function toMonet(project: Project): MonetFile {
  const src = (project.foreign ?? {}) as Partial<MonetDocument>;
  const doc: MonetDocument = {
    ...src, // id + any unknown document field, verbatim
    name: project.name,
    defaults: { ...(src.defaults ?? {}), fps: project.fps, width: project.width, height: project.height },
    media: project.media.map(mediaToMonet),
    sequences: project.sequences.map(sequenceToMonet),
    activeSequenceId: project.activeSequenceId,
    data: withData(src, undefined), // Cinema has no document-level payload
  };
  return createFile(doc, CINEMA_APP);
}

function mediaToMonet(m: MediaItem): MonetMedia {
  const src = (m.foreign ?? {}) as Partial<MonetMedia>;
  return {
    ...src, // duration.seconds, unknown fields, …
    id: m.id,
    name: m.name,
    kind: m.kind,
    // A carried source is embedded bytes (another app's PCM); a `{ path }` of
    // ours would delete it, so it wins over Cinema's (always empty) path.
    source: src.source ?? { path: m.path || null },
    duration: { frames: m.durationFrames, fps: m.fps },
    width: m.width,
    height: m.height,
    hasAudio: m.hasAudio,
    data: withData(src, m.color ? { color: m.color } : undefined),
  };
}

function sequenceToMonet(seq: Sequence): MonetSequence {
  const src = (seq.foreign ?? {}) as Partial<MonetSequence>;
  return {
    ...src,
    id: seq.id,
    name: seq.name,
    timeBase: { kind: "frames", fps: seq.fps },
    settings: {
      ...(src.settings ?? {}), // sampleRate/tempo/timeSignature belong to Rythme
      width: seq.width,
      height: seq.height,
      background: seq.background,
      duration: seq.durationFrames,
    },
    tracks: seq.tracks.map(trackToMonet),
    markers: seq.markers.map(markerToMonet),
  };
}

function markerToMonet(mk: Marker): MonetMarker {
  const src = (mk.foreign ?? {}) as Partial<MonetMarker>;
  // Cinema owns no marker namespace, so `src.data` passes through untouched.
  return { ...src, time: mk.frame, name: mk.name, color: mk.color };
}

function trackToMonet(t: Track): MonetTrack {
  const src = (t.foreign ?? {}) as Partial<MonetTrack>;
  const data: CinemaTrackData = { muted: t.muted, solo: t.solo, height: t.height, gain: t.gain };
  return {
    ...src,
    id: t.id,
    kind: t.kind,
    name: t.name,
    enabled: t.enabled,
    locked: t.locked,
    clips: t.clips.map(clipToMonet),
    data: withData(src, data),
  };
}

function clipToMonet(c: Clip): MonetClip {
  const src = (c.foreign ?? {}) as Partial<MonetClip>;
  const data: CinemaClipData = {
    kind: c.kind,
    transform: c.transform,
    color: c.color,
    effects: c.effects,
    audioGain: c.audioGain,
    fadeInFrames: c.fadeInFrames,
    fadeOutFrames: c.fadeOutFrames,
    transitionIn: c.transitionIn,
    transitionOut: c.transitionOut,
    linkedId: c.linkedId,
    label: c.label,
  };
  return {
    ...src,
    id: c.id,
    mediaId: c.mediaId,
    name: c.name,
    start: c.start,
    duration: c.duration,
    inPoint: c.inPoint,
    speed: c.speed,
    enabled: c.enabled,
    data: withData(src, data),
  };
}

// ── MonetFile → Project ───────────────────────────────────────
export function fromMonet(file: MonetFile): Project {
  const doc = file.document;
  const defFps = doc.defaults?.fps ?? 24;
  const { name: _n, defaults, media: _m, sequences: _s, activeSequenceId: _a, data, ...unowned } = doc;
  return {
    schema: SCHEMA_ID,
    name: doc.name,
    fps: defFps,
    width: doc.defaults?.width ?? 1920,
    height: doc.defaults?.height ?? 1080,
    media: doc.media.map((m) => mediaFromMonet(m, defFps)),
    sequences: doc.sequences.map((s) => sequenceFromMonet(s, defFps)),
    activeSequenceId: doc.activeSequenceId ?? null,
    foreign: cargo({ ...unowned, ...(defaults ? { defaults } : {}) }, foreignData(data)),
  };
}

function mediaFromMonet(m: MonetMedia, defFps: number): MediaItem {
  const fps = m.duration?.fps ?? defFps;
  const durationFrames = m.duration?.frames ?? (m.duration?.seconds != null ? Math.round(m.duration.seconds * fps) : 0);
  const cd = getData<{ color?: string }>(m, NS);
  const { id: _i, name: _n, kind: _k, source, duration: _du, width: _w, height: _h, hasAudio: _ha, data, ...unowned } = m;
  return {
    id: m.id,
    name: m.name,
    path: m.source.path ?? "",
    kind: m.kind,
    durationFrames,
    fps,
    width: m.width ?? 0,
    height: m.height ?? 0,
    hasAudio: m.hasAudio ?? false,
    color: cd.color,
    ready: false,
    // Only an embedded source rides along — Cinema's `path` cannot express one,
    // and re-emitting it is the difference between keeping and dropping the PCM.
    foreign: cargo({ ...unowned, ...(source.embed != null ? { source } : {}) }, foreignData(data)),
  };
}

function sequenceFromMonet(rawSeq: MonetSequence, defFps: number): Sequence {
  // Cross-open: convert a seconds sequence (e.g. a Rythme project) to frames.
  const fps = rawSeq.timeBase.kind === "frames" ? rawSeq.timeBase.fps : defFps;
  const seq = rawSeq.timeBase.kind === "frames" ? rawSeq : convertSequenceTimeBase(rawSeq, { kind: "frames", fps });
  const { id: _i, name: _n, timeBase: _tb, settings, tracks: _t, markers: _mk, ...unowned } = seq;
  return {
    id: seq.id,
    name: seq.name ?? "Sequence",
    fps,
    width: seq.settings?.width ?? 1920,
    height: seq.settings?.height ?? 1080,
    durationFrames: seq.settings?.duration ?? fps * 60,
    background: seq.settings?.background ?? "#000000",
    tracks: seq.tracks.map((t) => trackFromMonet(t, fps)),
    markers: (seq.markers ?? []).map(markerFromMonet),
    foreign: cargo({ ...unowned, ...(settings ? { settings } : {}) }, undefined),
  };
}

function markerFromMonet(mk: MonetMarker): Marker {
  const { time: _t, name: _n, color: _c, data, ...unowned } = mk;
  return {
    frame: Math.round(mk.time),
    name: mk.name ?? "",
    color: mk.color ?? "#fff",
    // `end` (a Rythme region) has already been unit-converted with the sequence.
    foreign: cargo(unowned, data),
  };
}

function trackFromMonet(t: MonetTrack, fps: number): Track {
  const cd = getData<Partial<CinemaTrackData>>(t, NS);
  const { id: _i, kind: _k, name: _n, enabled: _e, locked: _l, clips: _c, data, ...unowned } = t;
  return {
    id: t.id,
    kind: t.kind,
    name: t.name ?? t.id,
    enabled: t.enabled ?? true,
    locked: t.locked ?? false,
    muted: cd.muted ?? false,
    solo: cd.solo ?? false,
    height: cd.height ?? (t.kind === "video" ? 56 : 44),
    gain: cd.gain ?? 0,
    clips: t.clips.map((c) => clipFromMonet(c, t.kind, fps)),
    foreign: cargo(unowned, foreignData(data)),
  };
}

/** A `.monet` is untrusted input and `data.cinema` is ours to normalise: pin the
 *  Look slot's shape before it reaches the LUT parser / engine. The source text
 *  is kept verbatim (see sanitizeClipLut) so a look survives the round trip. */
function gradeFromData(g: ColorGrade | undefined): ColorGrade {
  if (!g) return defaultColorGrade();
  if (g.lut === undefined) return g;
  const lut = sanitizeClipLut(g.lut);
  const { lut: _raw, ...rest } = g;
  return lut ? { ...rest, lut } : rest;
}

function clipFromMonet(c: MonetClip, trackKind: "video" | "audio", fps: number): Clip {
  const cd = getData<Partial<CinemaClipData>>(c, NS);
  // Cross-open fallback: a foreign clip (no data.cinema) maps audio fields from
  // the Rythme payload where present, and gets default video transform/color.
  const ry = getData<{ gainDb?: number; fadeIn?: number; fadeOut?: number }>(c, "rythme");
  const hasCinema = c.data?.[NS] != null;
  const { id: _i, mediaId: _mi, name: _n, start: _s, duration: _d, inPoint: _ip, speed: _sp, enabled: _e, data, ...unowned } = c;
  return {
    id: c.id,
    mediaId: c.mediaId ?? "",
    name: c.name ?? "",
    kind: cd.kind ?? (trackKind === "audio" ? "audio" : "video"),
    start: c.start,
    duration: c.duration,
    inPoint: c.inPoint,
    speed: c.speed,
    enabled: c.enabled,
    transform: cd.transform ?? defaultTransform(),
    color: gradeFromData(cd.color),
    effects: cd.effects ?? [],
    audioGain: cd.audioGain ?? ry.gainDb ?? 0,
    fadeInFrames: cd.fadeInFrames ?? (ry.fadeIn != null ? Math.round(ry.fadeIn * fps) : 0),
    fadeOutFrames: cd.fadeOutFrames ?? (ry.fadeOut != null ? Math.round(ry.fadeOut * fps) : 0),
    transitionIn: cd.transitionIn,
    transitionOut: cd.transitionOut,
    linkedId: cd.linkedId,
    label: hasCinema ? (cd.label as Clip["label"]) : undefined,
    foreign: cargo(unowned, foreignData(data)),
  };
}
