// ─────────────────────────────────────────────────────────────
// types.ts — the Monet Cinema timeline document model.
//
// This is the canonical, framework-free data model: a Project owns media + a
// list of Sequences; a Sequence owns Tracks; a Track owns Clips. It serializes
// (via timeline/io) to the universal `.monet` document (@monet-ui/monet-format),
// Cinema's domain fields riding in the `data.cinema` bag. Runtime-only data
// (decoded frames, object URLs, thumbnails, waveform peaks) lives on the
// MediaItem but is NOT serialized.
// ─────────────────────────────────────────────────────────────

export type Id = string;

/** Opaque `.monet` payload owned by ANOTHER app (foreign `data.<app>` bags plus
 *  unknown/forward-compat fields). Cinema carries it verbatim from load to save
 *  and never reads into it — the courier rule, so a Rythme/Anime document
 *  survives a Cinema round-trip. */
export type ForeignPayload = Record<string, unknown>;

export type TrackKind = "video" | "audio";
export type ClipKind = "video" | "audio" | "image" | "title" | "color";
export type MediaKind = "video" | "audio" | "image" | "color";

/** A media asset in the project bin. One per imported file (or generated source). */
export interface MediaItem {
  id: Id;
  name: string;
  /** Native file path (Tauri) or a stable key; the runtime objectURL is separate. */
  path: string;
  kind: MediaKind;
  /** Length in the media's own frames (at `fps`). 0 for stills. */
  durationFrames: number;
  fps: number;
  width: number;
  height: number;
  hasAudio: boolean;
  /** For "color" sources: the matte color as `#rrggbb`. */
  color?: string;
  /** Another app's payload for this asset (incl. its `source`, e.g. embedded PCM). */
  foreign?: ForeignPayload;
  // ── runtime-only (never serialized) ──
  /** Blob URL for a <video>/<audio>/<img> element source. */
  objectUrl?: string;
  /** Small poster thumbnail data URL for the bin. */
  thumb?: string;
  /** Normalized 0..1 audio peak samples for waveform drawing. */
  peaks?: Float32Array;
  /** True once probed/decoded enough to play. */
  ready?: boolean;
}

export type EaseKind = "linear" | "hold" | "ease" | "ease-in" | "ease-out";

/** One keyframe on an animatable parameter. */
export interface Keyframe {
  frame: number; // relative to the clip start
  value: number;
  ease: EaseKind;
}

/** Geometric placement of a visual clip within the sequence frame. */
export interface Transform {
  /** Position of the clip anchor, in sequence pixels (center = w/2, h/2). */
  x: number;
  y: number;
  /** Uniform scale percentage (100 = source pixel-for-pixel before fit). */
  scale: number;
  scaleX: number;
  scaleY: number;
  /** Rotation in degrees. */
  rotation: number;
  /** Anchor point, normalized 0..1 of the source. */
  anchorX: number;
  anchorY: number;
  /** Opacity 0..100. */
  opacity: number;
  /** Compositing blend mode (kebab id; maps to engine BlendMode index). */
  blendMode: string;
  /** Normalized crop insets 0..1 from each edge. */
  cropL: number;
  cropT: number;
  cropR: number;
  cropB: number;
}

/** A creative "Look": an imported 3D LUT (Adobe `.cube` / Autodesk `.3dl`)
 *  attached to a clip's grade, applied after the primary correction.
 *
 *  The SOURCE TEXT rides along verbatim, so the LUT survives a `.monet` round
 *  trip and stays the same interchange artefact every other Monet app speaks
 *  (Vision's File ▸ Export ▸ Color Lookup Tables emits exactly this).
 *  ponytail: one copy of the text per clip — a 33³ cube is ~700 KB, so a
 *  project that puts the same look on 50 clips pays for it 50 times. Hoist to a
 *  document-level LUT bin keyed by hash if that ever bites. */
export interface ClipLut {
  /** Display name (the imported file's basename). */
  name: string;
  /** Verbatim `.cube` / `.3dl` source text; parsed on demand (state/effects). */
  text: string;
  /** Blend toward the look, 0..1 (1 = full strength). */
  intensity: number;
}

/** Lumetri-style primary color grade. Mirrors the engine `color.rs` param block. */
export interface ColorGrade {
  enabled: boolean;
  exposure: number; // stops
  contrast: number; // -1..1
  saturation: number; // -1..1
  temperature: number; // -1..1
  tint: number; // -1..1
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  vibrance: number;
  hue: number; // degrees
  gamma: number; // 1 = neutral
  lift: number;
  gain: number; // 1 = neutral
  /** Creative Look slot — absent means no LUT. */
  lut?: ClipLut;
}

/** A non-color effect in the clip's stack (blur, transform fx, key, etc.). */
export interface Effect {
  id: Id;
  type: string; // e.g. "gaussian-blur", "ultra-key", "crop", "lumetri"
  name: string;
  enabled: boolean;
  params: Record<string, number>;
  keyframes?: Record<string, Keyframe[]>;
}

export type TransitionKind =
  | "cross-dissolve"
  | "dip-to-black"
  | "dip-to-white"
  | "wipe"
  | "push"
  | "slide"
  | "iris";

/** An edit-point transition attached to a clip head/tail. */
export interface Transition {
  kind: TransitionKind;
  durationFrames: number;
  /** Wipe direction in degrees (linear/push/slide). */
  angle?: number;
}

export type ClipLabel =
  | "violet"
  | "iris"
  | "caribbean"
  | "lavender"
  | "cerulean"
  | "forest"
  | "rose"
  | "mango";

/** One edit on a track: a windowed view of a MediaItem placed on the timeline. */
export interface Clip {
  id: Id;
  mediaId: Id;
  name: string;
  kind: ClipKind;
  /** Timeline position (sequence frames). */
  start: number;
  /** Length on the timeline (sequence frames). */
  duration: number;
  /** First used source frame. */
  inPoint: number;
  enabled: boolean;
  /** Playback speed multiplier (1 = normal, <0 = reversed). */
  speed: number;
  transform: Transform;
  color: ColorGrade;
  effects: Effect[];
  /** Audio level in dB (0 = unity). */
  audioGain: number;
  /** Per-clip audio fade lengths, in frames. */
  fadeInFrames: number;
  fadeOutFrames: number;
  transitionIn?: Transition;
  transitionOut?: Transition;
  /** The linked A/V counterpart clip id, if linked. */
  linkedId?: Id;
  label?: ClipLabel;
  foreign?: ForeignPayload;
}

export interface Track {
  id: Id;
  kind: TrackKind;
  name: string;
  clips: Clip[];
  /** Video: track output visible. */
  enabled: boolean;
  locked: boolean;
  /** Audio: muted. */
  muted: boolean;
  solo: boolean;
  /** UI row height in px. */
  height: number;
  /** Audio: track level in dB. */
  gain: number;
  foreign?: ForeignPayload;
}

export interface Marker {
  frame: number;
  name: string;
  color: string;
  /** Carries e.g. a Rythme region's `end` + `data.rythme` id/kind. */
  foreign?: ForeignPayload;
}

export interface Sequence {
  id: Id;
  name: string;
  fps: number;
  width: number;
  height: number;
  /** Video tracks (top-of-stack last) then audio tracks. */
  tracks: Track[];
  markers: Marker[];
  /** Explicit sequence length; clamps to content extent when shorter. */
  durationFrames: number;
  /** Background matte color `#rrggbb` (letterbox / empty program). */
  background: string;
  /** Carries the source sequence's unowned settings (sampleRate/tempo/…). */
  foreign?: ForeignPayload;
}

export interface Project {
  schema: string;
  name: string;
  fps: number;
  width: number;
  height: number;
  media: MediaItem[];
  sequences: Sequence[];
  activeSequenceId: Id | null;
  /** Carries the document id, unowned defaults and foreign `data.<app>` bags. */
  foreign?: ForeignPayload;
}

export const SCHEMA_ID = "monet-cinema/v1";
