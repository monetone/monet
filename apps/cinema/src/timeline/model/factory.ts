// ─────────────────────────────────────────────────────────────
// factory.ts — constructors + defaults for the timeline model.
//
// All model objects are created here so defaults stay in one place. Ids are
// short, monotonic, prefixed strings (stable within a session; the project is
// reloaded fresh from disk). Keep this framework-free.
// ─────────────────────────────────────────────────────────────

import {
  type Clip,
  type ClipKind,
  type ColorGrade,
  type Effect,
  type Id,
  type MediaItem,
  type MediaKind,
  type Project,
  type Sequence,
  type Track,
  type TrackKind,
  type Transform,
  SCHEMA_ID,
} from "./types";

// Ids come from the shared timeline engine so generic ops (split/insert/
// duplicate) and Cinema's factories draw from ONE monotonic counter — no
// collisions. Imported into scope (factories below call newId) + re-exported
// for existing import sites + tests.
import { newId, resetIds } from "@monet-ui/monet-timeline";
export { newId, resetIds };

export function defaultTransform(): Transform {
  return {
    x: 0,
    y: 0,
    scale: 100,
    scaleX: 100,
    scaleY: 100,
    rotation: 0,
    anchorX: 0.5,
    anchorY: 0.5,
    opacity: 100,
    blendMode: "normal",
    cropL: 0,
    cropT: 0,
    cropR: 0,
    cropB: 0,
  };
}

export function defaultColorGrade(): ColorGrade {
  return {
    enabled: false,
    exposure: 0,
    contrast: 0,
    saturation: 0,
    temperature: 0,
    tint: 0,
    highlights: 0,
    shadows: 0,
    whites: 0,
    blacks: 0,
    vibrance: 0,
    hue: 0,
    gamma: 1,
    lift: 0,
    gain: 1,
  };
}

export function createEffect(type: string, name: string, params: Record<string, number> = {}): Effect {
  return { id: newId("fx"), type, name, enabled: true, params };
}

export interface MediaInit {
  name: string;
  path?: string;
  kind: MediaKind;
  durationFrames?: number;
  fps?: number;
  width?: number;
  height?: number;
  hasAudio?: boolean;
  color?: string;
}

export function createMedia(init: MediaInit): MediaItem {
  return {
    id: newId("media"),
    name: init.name,
    path: init.path ?? "",
    kind: init.kind,
    durationFrames: init.durationFrames ?? 0,
    fps: init.fps ?? 24,
    width: init.width ?? 0,
    height: init.height ?? 0,
    hasAudio: init.hasAudio ?? false,
    color: init.color,
  };
}

export interface ClipInit {
  mediaId?: Id;
  name: string;
  kind: ClipKind;
  start: number;
  duration: number;
  inPoint?: number;
  speed?: number;
}

export function createClip(init: ClipInit): Clip {
  return {
    id: newId("clip"),
    mediaId: init.mediaId ?? "",
    name: init.name,
    kind: init.kind,
    start: init.start,
    duration: init.duration,
    inPoint: init.inPoint ?? 0,
    enabled: true,
    speed: init.speed ?? 1,
    transform: defaultTransform(),
    color: defaultColorGrade(),
    effects: [],
    audioGain: 0,
    fadeInFrames: 0,
    fadeOutFrames: 0,
  };
}

export function createTrack(kind: TrackKind, name: string): Track {
  return {
    id: newId(kind === "video" ? "V" : "A"),
    kind,
    name,
    clips: [],
    enabled: true,
    locked: false,
    muted: false,
    solo: false,
    height: kind === "video" ? 56 : 44,
    gain: 0,
  };
}

export interface SequenceInit {
  name?: string;
  fps?: number;
  width?: number;
  height?: number;
  videoTracks?: number;
  audioTracks?: number;
  durationFrames?: number;
}

export function createSequence(init: SequenceInit = {}): Sequence {
  const fps = init.fps ?? 24;
  const vCount = init.videoTracks ?? 3;
  const aCount = init.audioTracks ?? 3;
  const tracks: Track[] = [];
  // Audio tracks sit below video; we keep video first (index 0 = bottom video,
  // V1) ordering with audio appended — render flips the visual stack.
  for (let i = 0; i < vCount; i++) tracks.push(createTrack("video", `V${i + 1}`));
  for (let i = 0; i < aCount; i++) tracks.push(createTrack("audio", `A${i + 1}`));
  return {
    id: newId("seq"),
    name: init.name ?? "Sequence 01",
    fps,
    width: init.width ?? 1920,
    height: init.height ?? 1080,
    tracks,
    markers: [],
    durationFrames: init.durationFrames ?? fps * 60,
    background: "#000000",
  };
}

export function createProject(name = "Untitled"): Project {
  const seq = createSequence();
  return {
    schema: SCHEMA_ID,
    name,
    fps: seq.fps,
    width: seq.width,
    height: seq.height,
    media: [],
    sequences: [seq],
    activeSequenceId: seq.id,
  };
}
