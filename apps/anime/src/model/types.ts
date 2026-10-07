// ─────────────────────────────────────────────────────────────
// model/types — the Monet Anime document model (After Effects-class).
//
// A Project holds Compositions; a Composition holds Layers stacked front→back
// (index 0 = topmost/front). Every Layer has a base Transform plus keyframed
// AnimTracks that override individual transform properties over time, and a
// stack of Effects. The model is plain-JSON (cloned for undo) — no class
// instances, functions, Map or Set. Time is in SECONDS; fps drives display/snap.
// ─────────────────────────────────────────────────────────────

export type Id = string;

/** Opaque `.monet` payload owned by ANOTHER app (foreign `data.<app>` bags,
 *  unknown/forward-compat fields, the source track layout). Anime carries it
 *  verbatim from load to save and never reads into it — the courier rule. */
export type ForeignPayload = Record<string, unknown>;

/** Easing curves a keyframe segment can use (see model/ease.ts). */
export type EaseId =
  | "linear" | "hold"
  | "sineIn" | "sineOut" | "sineInOut"
  | "quadIn" | "quadOut" | "quadInOut"
  | "cubicIn" | "cubicOut" | "cubicInOut"
  | "quartInOut" | "expoOut"
  | "backIn" | "backOut" | "backInOut"
  | "elasticOut" | "bounceOut";

export type LayerKind = "solid" | "shape" | "text" | "image" | "null";
export type ShapeKind = "rect" | "ellipse";
export type BlendMode =
  | "normal" | "multiply" | "screen" | "overlay"
  | "lighten" | "darken" | "add" | "difference";

export interface Transform {
  x: number; // position in composition pixels (where the anchor lands)
  y: number;
  anchorX: number; // anchor point in layer-local pixels
  anchorY: number;
  scaleX: number; // percent (100 = 1×)
  scaleY: number;
  rotation: number; // degrees
  opacity: number; // 0..100
}

/** Transform properties that can be keyframed (1:1 with Transform fields). */
export type TrackProperty =
  | "x" | "y" | "anchorX" | "anchorY"
  | "scaleX" | "scaleY" | "rotation" | "opacity";

export interface Keyframe {
  id: Id;
  time: number; // seconds
  value: number;
  ease: EaseId; // easing of the segment LEAVING this keyframe
}

export interface AnimTrack {
  id: Id;
  property: TrackProperty;
  keyframes: Keyframe[]; // kept sorted ascending by time
}

export type EffectKind = "blur" | "glow" | "dropShadow" | "brightness" | "tint";
export interface Effect {
  id: Id;
  kind: EffectKind;
  enabled: boolean;
  params: Record<string, number>;
}

export interface Layer {
  id: Id;
  name: string;
  kind: LayerKind;
  visible: boolean;
  locked: boolean;
  solo: boolean;
  inPoint: number; // seconds — layer is live in [inPoint, outPoint)
  outPoint: number;
  blendMode: BlendMode;
  transform: Transform; // base/static values; tracks override per-property
  tracks: AnimTrack[];
  effects: Effect[];
  // appearance (kind-specific)
  color: string; // solid/shape fill, text color
  width: number;
  height: number;
  shape?: ShapeKind;
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  align?: "left" | "center" | "right";
  src?: string; // image data URL
  // ── courier (io/monet-adapter) — not authored in the UI ──
  /** Id of the `.monet` track this layer was loaded from, so save restores it. */
  trackId?: Id;
  /** Source clip fields Anime doesn't own (mediaId, trim/speed, other apps' data). */
  foreign?: ForeignPayload;
}

export interface Composition {
  id: Id;
  name: string;
  width: number;
  height: number;
  fps: number;
  duration: number; // seconds
  background: string;
  layers: Layer[]; // index 0 = top (front)
  /** Source sequence fields Anime doesn't own (markers, track shells, settings). */
  foreign?: ForeignPayload;
}

export interface AnimeProject {
  name: string;
  compositions: Composition[];
  activeCompId: Id;
  /** Source document fields Anime doesn't own (media library, other apps' data). */
  foreign?: ForeignPayload;
}
