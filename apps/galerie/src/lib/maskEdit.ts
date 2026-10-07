// maskEdit — app-side helpers for authoring the Develop mask graph. The pure
// render math lives in @monet-ui/monet-photo (maskRender); this is the small
// UI glue: seed a new gradient mask with sensible geometry, and pick which masks
// the composite loop actually needs to render.

import {
  createMask,
  type AiComponent,
  type BrushComponent,
  type CombineMode,
  type Mask,
  type MaskComponent,
  type MaskGraph,
} from "@monet-ui/monet-photo";

export type GradientKind = "linearGradient" | "radialGradient";
export type RangeKind = "rangeColor" | "rangeLuminance";
/** A stackable (non-AI) component kind: appended to an existing mask with a
 *  combine mode to refine it (Add / Subtract / Intersect). */
export type ComponentKind = GradientKind | RangeKind | "brush";
/** Depth Range is the third Range sub-tool, but it only produces coverage on a
 *  photo that carries a depth map, so it stays out of `RangeKind` — the panels
 *  key exhaustive label records off that and must not offer a tool that can do
 *  nothing. ponytail: fold it into RangeKind once import decodes depth (HEIC
 *  auxiliary image) and the panel can hide the button when there is none. */
export type DepthKind = "rangeDepth";

/** Brush authoring settings (per-stroke; each dab is stamped with these). */
export interface BrushSettings {
  /** Radius as a fraction of the image's shorter side (matches the kernel). */
  radius: number;
  flow: number;
  density: number;
  erase: boolean;
}

/** The next dab for a stroke, or null if the pointer hasn't moved far enough
 *  from the last dab (quarter-radius spacing lays a continuous stroke without
 *  over-stamping the same spot). Coordinates are normalized 0..1. */
export function strokeDab(
  last: { x: number; y: number } | null,
  x: number,
  y: number,
  s: BrushSettings,
): BrushComponent["dabs"][number] | null {
  if (last && Math.hypot(x - last.x, y - last.y) < s.radius * 0.25) return null;
  return { x, y, radius: s.radius, flow: s.flow, density: s.density, erase: s.erase };
}

/** A fresh mask component with LR-default geometry, ready to append to an
 *  existing mask's `components` for Add/Subtract/Intersect refinement. `combine`
 *  is ignored on the base (first) component but honored on every stacked one.
 *  AI components aren't built here — their coverage is a computed cache — but
 *  any of these kinds can be stacked onto an AI-based mask to refine it
 *  (maskCoverage folds them onto the cached subject coverage). */
export function newComponent(
  kind: ComponentKind | DepthKind,
  id: string,
  combine: CombineMode,
): MaskComponent {
  switch (kind) {
    case "linearGradient":
      return { kind, id, combine, invert: false, x1: 0.5, y1: 0.15, x2: 0.5, y2: 0.55 };
    case "radialGradient":
      return { kind, id, combine, invert: false, cx: 0.5, cy: 0.5, rx: 0.3, ry: 0.3, angle: 0, feather: 0.5 };
    case "rangeColor":
      return { kind, id, combine, invert: false, samples: [], refine: 0.5 };
    case "rangeLuminance":
      return { kind, id, combine, invert: false, min: 0.25, max: 0.75, smoothness: 0.5 };
    case "rangeDepth":
      // Near half of the depth range: the subject side of a portrait capture.
      return { kind, id, combine, invert: false, near: 0, far: 0.5, smoothness: 0.5 };
    case "brush":
      return { kind, id, combine, invert: false, dabs: [], autoMask: false };
  }
}

/** A new gradient mask (neutral local adjustments) with default geometry —
 *  linear = a top-down graduated filter; radial = a centered soft ellipse. */
export function newGradientMask(kind: GradientKind, id: string, name: string): Mask {
  return createMask(id, name, newComponent(kind, `${id}-c`, "add"));
}

/** A new range mask. Color range starts with no samples (zero coverage until
 *  the user picks one); luminance range defaults to a midtones band so it does
 *  something visible immediately. */
export function newRangeMask(kind: RangeKind | DepthKind, id: string, name: string): Mask {
  return createMask(id, name, newComponent(kind, `${id}-c`, "add"));
}

/** A new (empty) brush mask; strokes are stamped onto it via the canvas. */
export function newBrushMask(id: string, name: string): Mask {
  return createMask(id, name, newComponent("brush", `${id}-c`, "add"));
}

function newAiMask(kind: AiComponent["kind"], id: string, name: string, cacheId: string): Mask {
  const base: AiComponent = {
    kind,
    id: `${id}-c`,
    combine: "add",
    invert: false,
    model: "u2netp",
    cacheId,
  };
  return createMask(id, name, base);
}

/** A new Select-Subject AI mask; `cacheId` keys its computed U²-Net coverage. */
export function newAiSubjectMask(id: string, name: string, cacheId: string): Mask {
  return newAiMask("aiSubject", id, name, cacheId);
}

/** A new Select-Background AI mask — Subject's complement, sharing the same
 *  cached U²-Net coverage (maskCoverage inverts it at render time), so no
 *  extra inference run is needed. */
export function newAiBackgroundMask(id: string, name: string, cacheId: string): Mask {
  return newAiMask("aiBackground", id, name, cacheId);
}

/** Is this base-component kind backed by the session U²-Net coverage cache?
 *  (Background is Subject's complement — same cache, inverted at render.) */
export function isCachedAiKind(kind: string | undefined): kind is "aiSubject" | "aiBackground" {
  return kind === "aiSubject" || kind === "aiBackground";
}

/** Kinds whose parametric coverage the pure composite loop renders. AI masks
 *  are handled separately (their coverage is a computed cache, not parametric),
 *  so they're intentionally excluded here. */
const RENDERABLE_KINDS = new Set([
  "linearGradient",
  "radialGradient",
  "rangeColor",
  "rangeLuminance",
  "rangeDepth",
  "brush",
]);

/** Masks the pure composite render must process: enabled, with a renderable
 *  BASE component. Keyed on the base because a mask's identity is its first
 *  component — an AI mask refined with a stacked brush must stay in the AI
 *  path (session-cached coverage), not turn into a brush mask here. A
 *  still-empty mask (neutral adjustments) is skipped later so it doesn't cost
 *  a render for no change. */
export function renderableMasks(graph: MaskGraph): Mask[] {
  return graph.masks.filter(
    (m) => m.enabled && RENDERABLE_KINDS.has(m.components[0]?.kind ?? ""),
  );
}

/** Does any renderable component in this graph sample the base image (range
 *  kinds)? The composite loop only builds the MaskRenderSource when true.
 *  rangeDepth counts: it reads the source's `depth` channel, which rides on the
 *  same object, so the source has to exist for it to be passed at all. */
export function needsBaseImage(masks: Mask[]): boolean {
  return masks.some((m) =>
    m.components.some(
      (c) => c.kind === "rangeColor" || c.kind === "rangeLuminance" || c.kind === "rangeDepth",
    ),
  );
}
