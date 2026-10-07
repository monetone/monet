// ─────────────────────────────────────────────────────────────
// schema.ts — the universal `.monet` project document schema.
//
// One envelope every Monet app reads + writes. Design:
//  • SELF-DESCRIBING TIME per sequence (`timeBase`: frames+fps | seconds) — no
//    hidden global unit; a sequence saved + reopened by its authoring app never
//    converts, so it's exactly lossless. Cross-open converts once on load.
//  • SHARED TIMING BACKBONE on every clip — matches @monet-ui/monet-timeline's
//    `TimelineClip` (id/start/duration/inPoint/speed/enabled).
//  • NAMESPACED `data.<app>` bags carry per-app domain payload (video transform/
//    color/effects; audio gain/pan/fades). A non-owning app preserves foreign
//    namespaces verbatim, so an A→B→A round-trip keeps domain data bit-for-bit.
// camelCase keys throughout.
// ─────────────────────────────────────────────────────────────

import type { TimelineClip } from "@monet-ui/monet-timeline";

export const MONET_FORMAT = "monet";
export const SCHEMA_VERSION = 1;

export type AppName = "monet-cinema" | "monet-rythme" | (string & {});

/** Per-sequence time unit. Times in that sequence are in this unit. */
export type TimeBase = { kind: "frames"; fps: number } | { kind: "seconds" };

export type MediaKind = "video" | "audio" | "image" | "color";
export type TrackKind = "video" | "audio";

/** Per-entity namespaced payload bag, e.g. `{ cinema: {...}, rythme: {...} }`. */
export type DataBag = Record<string, unknown>;

/** A duration expressed in either unit (whichever the source knows). */
export interface MonetDuration {
  frames?: number;
  fps?: number;
  seconds?: number;
}

export interface MonetMedia {
  id: string;
  name: string;
  kind: MediaKind;
  /** `path` XOR `embed` (embedded PCM/bytes). */
  source: { path?: string | null; embed?: unknown | null };
  duration?: MonetDuration;
  width?: number;
  height?: number;
  hasAudio?: boolean;
  data?: DataBag;
}

/** A clip: the shared timing backbone + a namespaced domain `data` bag. */
export interface MonetClip extends TimelineClip {
  mediaId?: string;
  name?: string;
  data?: DataBag;
}

export interface MonetTrack {
  id: string;
  kind: TrackKind;
  name?: string;
  enabled?: boolean;
  locked?: boolean;
  clips: MonetClip[];
  data?: DataBag;
}

/** Unit-independent sequence configuration (video + audio fields coexist). */
export interface MonetSequenceSettings {
  width?: number;
  height?: number;
  sampleRate?: number;
  tempo?: number;
  timeSignature?: [number, number];
  background?: string;
  masterGainDb?: number;
  /** Total length, in the sequence's timeBase units. */
  duration?: number;
}

export interface MonetMarker {
  /** In the sequence's timeBase units. */
  time: number;
  /** Region end (audio) or null/absent for a cue point. */
  end?: number | null;
  name?: string;
  color?: string;
  data?: DataBag;
}

export interface MonetSequence {
  id: string;
  name?: string;
  timeBase: TimeBase;
  settings?: MonetSequenceSettings;
  tracks: MonetTrack[];
  markers?: MonetMarker[];
}

export interface MonetDocument {
  id?: string;
  name: string;
  defaults?: { fps?: number; width?: number; height?: number; sampleRate?: number };
  media: MonetMedia[];
  sequences: MonetSequence[];
  activeSequenceId?: string | null;
  data?: DataBag;
}

/** The top-level `.monet` file envelope. */
export interface MonetFile {
  format: typeof MONET_FORMAT;
  schemaVersion: number;
  app: { name: AppName; version: string };
  document: MonetDocument;
}
