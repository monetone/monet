// maskGraph — the persistent mask-graph schema shared by the Monet photo apps.
//
// A mask is an ordered set of *components* (brush strokes, gradients, range
// selections, AI selections) combined with Add/Subtract/Intersect, plus one set
// of local adjustments applied where the mask is active. This is the storage
// contract only (types + factories); the mask *tools* that author these live in
// the app. Framework-free and app-neutral — no React/DOM, no random
// (callers pass ids so the schema stays deterministic/testable).

/** How a component folds into the accumulated mask. */
export type CombineMode = "add" | "subtract" | "intersect";

/** AI-selection component kinds (each backed by a segmentation model). */
export type AiMaskKind =
  | "aiSubject"
  | "aiSky"
  | "aiBackground"
  | "aiObjects"
  | "aiPeople"
  | "aiLandscape";

export type MaskComponentKind =
  | "brush"
  | "linearGradient"
  | "radialGradient"
  | "rangeColor"
  | "rangeLuminance"
  | "rangeDepth"
  | AiMaskKind;

/** Fields every component carries. Geometry is normalized to 0..1 of the FULL
 *  (uncropped, oriented) frame — masks fold before crop, which is a viewport
 *  step — so a mask keeps its place on the photo when the crop changes. Tools
 *  editing through a cropped view map via cropToFrame/maskToCropSpace. */
interface ComponentBase {
  /** Caller-supplied stable id (the app/store generates these). */
  id: string;
  /** How this component combines with the ones before it. */
  combine: CombineMode;
  /** Invert just this component's coverage. */
  invert: boolean;
}

/** One brush dab; a stroke is a run of dabs (density/flow let them accumulate). */
export interface BrushDab {
  x: number;
  y: number;
  /** Radius in normalized image units. */
  radius: number;
  flow: number;
  density: number;
  /** Erase (subtract from this component) rather than paint. */
  erase: boolean;
}

export interface BrushComponent extends ComponentBase {
  kind: "brush";
  dabs: BrushDab[];
  /** Auto Mask (edge-aware flood constraint). */
  autoMask: boolean;
  /** Edge feather 0..1: soft ramp starts at (1-feather)·radius. Absent = 1
   *  (ramp over the whole radius — the pre-feather look), so stored graphs
   *  keep parsing and rendering identically. */
  feather?: number;
}

export interface LinearGradientComponent extends ComponentBase {
  kind: "linearGradient";
  /** Start/end of the gradient axis (normalized). */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface RadialGradientComponent extends ComponentBase {
  kind: "radialGradient";
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** Rotation of the ellipse, radians. */
  angle: number;
  /** Edge feather, 0..1. */
  feather: number;
}

export interface ColorRangeComponent extends ComponentBase {
  kind: "rangeColor";
  /** Sampled colors (normalized rgb) that seed the selection. */
  samples: Array<{ r: number; g: number; b: number }>;
  /** Refinement / amount, 0..1. */
  refine: number;
}

export interface LuminanceRangeComponent extends ComponentBase {
  kind: "rangeLuminance";
  /** Selected luminance band [min,max] in 0..1 + edge smoothness. */
  min: number;
  max: number;
  smoothness: number;
}

export interface DepthRangeComponent extends ComponentBase {
  kind: "rangeDepth";
  /** Selected depth band [near,far] in 0..1 (needs a depth model/map). */
  near: number;
  far: number;
  /** Edge smoothness 0..1, same band ramp as rangeLuminance. Absent = 0.5 (what
   *  the tool creates), so graphs stored before the slider existed keep parsing
   *  and render as they did. */
  smoothness?: number;
}

export interface AiComponent extends ComponentBase {
  kind: AiMaskKind;
  /** Segmentation model id (e.g. "u2netp"); pinned for reproducibility. */
  model: string;
  /** Cache id of the computed coverage map (recomputed if stale). */
  cacheId: string | null;
}

export type MaskComponent =
  | BrushComponent
  | LinearGradientComponent
  | RadialGradientComponent
  | ColorRangeComponent
  | LuminanceRangeComponent
  | DepthRangeComponent
  | AiComponent;

/** Local (masked) adjustments — the subset of develop params LR allows per
 *  mask. Neutral = 0 everywhere. */
export interface LocalAdjustments {
  exposure: number;
  contrast: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  texture: number;
  clarity: number;
  dehaze: number;
  saturation: number;
  /** Local white-balance offsets. */
  temp: number;
  tint: number;
  /** Local detail. */
  sharpness: number;
  noise: number;
  moire: number;
  defringe: number;
}

export interface Mask {
  id: string;
  name: string;
  enabled: boolean;
  /** Invert the whole combined mask. */
  inverted: boolean;
  /** Overall mask opacity, 0..1. */
  opacity: number;
  /** Ordered components; the first is the base (its `combine` is ignored). */
  components: MaskComponent[];
  adjustments: LocalAdjustments;
}

/** The persistent mask graph for one photo: an ordered list of masks.
 *  ponytail: flat list — no mask groups. LR nests masks in groups carrying
 *  their own invert/opacity, which needs a recursive node type threaded through
 *  maskRender + the app's composite loop; add when a catalog actually stacks
 *  more masks than a flat list reads well. */
export interface MaskGraph {
  masks: Mask[];
}

/** Neutral local adjustments (all zero). */
export function createLocalAdjustments(): LocalAdjustments {
  return {
    exposure: 0,
    contrast: 0,
    highlights: 0,
    shadows: 0,
    whites: 0,
    blacks: 0,
    texture: 0,
    clarity: 0,
    dehaze: 0,
    saturation: 0,
    temp: 0,
    tint: 0,
    sharpness: 0,
    noise: 0,
    moire: 0,
    defringe: 0,
  };
}

/** A mask seeded with one base component (neutral local adjustments). */
export function createMask(id: string, name: string, base: MaskComponent): Mask {
  return {
    id,
    name,
    enabled: true,
    inverted: false,
    opacity: 1,
    components: [base],
    adjustments: createLocalAdjustments(),
  };
}

export function createMaskGraph(): MaskGraph {
  return { masks: [] };
}

/** A copy of `mask` with fresh ids — one for the mask, one per component. Ids
 *  must stay unique or the overlay and the component editors would drive both
 *  copies at once; `newId` is caller-supplied so the schema stays deterministic.
 *  `invert` flips the copy's overall inversion: LR's "Duplicate and Invert
 *  Mask", the gesture for treating subject and background separately. AI
 *  components keep their `cacheId` — the coverage is the same pixels. */
export function duplicateMask(mask: Mask, newId: () => string, invert = false): Mask {
  return {
    ...mask,
    id: newId(),
    name: `${mask.name} ${invert ? "inverted" : "copy"}`,
    inverted: invert ? !mask.inverted : mask.inverted,
    components: mask.components.map((c) => ({ ...c, id: newId() })),
  };
}

/** Move a mask `delta` places within the graph, clamped to the ends (unknown id
 *  = no-op). Order is meaningful: masks composite in list order. */
export function moveMask(masks: Mask[], id: string, delta: number): Mask[] {
  const from = masks.findIndex((m) => m.id === id);
  if (from < 0) return masks;
  const to = Math.min(masks.length - 1, Math.max(0, from + delta));
  if (to === from) return masks;
  const next = masks.slice();
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}
