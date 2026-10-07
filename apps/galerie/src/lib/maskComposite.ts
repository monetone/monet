// maskComposite — fold a recipe's local (masked) adjustments into a rendered
// frame. Extracted verbatim from the Develop preview loop (DevelopView) so every
// render site shares ONE mask composite: previously Export / Web / Print / the
// contact sheet all dropped local masks silently, because compositing lived only
// in the preview's rAF closure (docs/plans/10-monet-photo-refactor.md §6, "the
// mask half needs Galerie app work").
//
// Coverage is computed in normalized space, so the same masks resolve correctly
// at preview proxy size and at full export resolution.

import {
  blendMasked,
  computeMaskCoverage,
  foldLocalAdjustments,
  type DevelopRecipeV2,
  type LocalAdjustments,
  type Mask,
} from "@monet-ui/monet-photo";
import { resampleCoverage } from "@monet-ui/monet-scopes";

import { isCachedAiKind, needsBaseImage, renderableMasks } from "./maskEdit";
import { getSubjectCoverage } from "./subjectMask";

export interface RenderedFrame {
  /** RGBA8; engine renders yield Uint8Array, the composite yields clamped. */
  rgba: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
  /** Optional depth channel for rangeDepth masks (0..1 per pixel, row-major,
   *  same width/height as rgba). ponytail: no render site populates this yet
   *  — nothing in Galerie decodes a depth map (iPhone Portrait HEIC auxiliary
   *  image / a depth model) — so a Depth Range mask covers nothing on any
   *  real photo today until a render site attaches one here. */
  depth?: Float32Array;
}

const isNeutral = (adj: LocalAdjustments): boolean => Object.values(adj).every((v) => v === 0);

/** The develop base frame as the coverage overlay needs it: dimensions always,
 *  base pixels only when the graph has range masks (the composite already
 *  snapshots those). */
export interface OverlayFrame {
  width: number;
  height: number;
  base?: { pixels: Uint8ClampedArray; width: number; height: number; depth?: Float32Array };
}

// Latest frame compositeMasks saw, published for MaskOverlay's coverage tint.
// Session-scoped module cache — the same pattern as subjectMask's coverageCache
// — with listeners so the overlay repaints after the render that follows a mask
// edit. ponytail: an Export/Print composite also publishes here briefly at full
// resolution; the next preview render overwrites it, so the worst case is one
// expensive tint paint, not a wrong one.
let overlayFrame: OverlayFrame | null = null;
const overlayListeners = new Set<() => void>();

export function getOverlayFrame(): OverlayFrame | null {
  return overlayFrame;
}

/** Subscribe to overlay-frame publishes; returns the unsubscribe. */
export function onOverlayFrame(listener: () => void): () => void {
  overlayListeners.add(listener);
  return () => {
    overlayListeners.delete(listener);
  };
}

/**
 * A mask's full coverage field at width×height — parametric components via
 * computeMaskCoverage, AI (Select Subject / Background) masks via their session
 * coverage cache, then any stacked refinement components (Subtract > Brush, Intersect >
 * Luminance Range, …) folded on with the same combine operators the parametric
 * path uses, and finally the mask's invert + opacity. Null for an AI mask whose
 * coverage is absent from the cache (never computed, and nothing persisted to
 * hydrate from).
 */
export function maskCoverage(
  mask: Mask,
  width: number,
  height: number,
  base?: OverlayFrame["base"],
): Float32Array | null {
  const c0 = mask.components[0];
  if (c0?.kind === "aiSubject" || c0?.kind === "aiBackground") {
    if (!c0.cacheId) return null;
    const cached = getSubjectCoverage(c0.cacheId);
    if (!cached) return null;
    const cov = resampleCoverage(cached, width, height);
    // Background is the complement of the cached subject coverage; the
    // component's own invert then folds on top (XOR).
    const flip = (c0.kind === "aiBackground") !== c0.invert;
    if (flip) for (let i = 0; i < cov.length; i++) cov[i] = 1 - cov[i];
    // Refinement components: reuse the parametric per-component math by
    // rendering each one alone (invert folded, opacity/inversion deferred),
    // then combine — the same add/subtract/intersect fold computeMaskCoverage
    // applies. One extra pass per component; stacks are a handful deep at most.
    for (const c of mask.components.slice(1)) {
      const f = computeMaskCoverage(
        { ...mask, inverted: false, opacity: 1, components: [c] },
        width,
        height,
        base,
      );
      if (c.combine === "add") for (let i = 0; i < cov.length; i++) cov[i] = cov[i] > f[i] ? cov[i] : f[i];
      else if (c.combine === "subtract") for (let i = 0; i < cov.length; i++) cov[i] *= 1 - f[i];
      else for (let i = 0; i < cov.length; i++) cov[i] = cov[i] < f[i] ? cov[i] : f[i];
    }
    const op = Math.max(0, Math.min(1, mask.opacity));
    for (let i = 0; i < cov.length; i++) cov[i] = (mask.inverted ? 1 - cov[i] : cov[i]) * op;
    return cov;
  }
  return computeMaskCoverage(mask, width, height, base);
}

export type OverlayMode = "color" | "whiteOnBlack";

/** Rasterize a coverage field into overlay RGBA: `color` tints selected pixels
 *  (alpha follows coverage, half strength so the image stays readable),
 *  `whiteOnBlack` shows the matte itself, opaque. */
export function tintCoverage(
  cov: Float32Array,
  mode: OverlayMode,
  rgb: readonly [number, number, number],
): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(cov.length * 4);
  for (let i = 0; i < cov.length; i++) {
    const o = i * 4;
    if (mode === "color") {
      out[o] = rgb[0];
      out[o + 1] = rgb[1];
      out[o + 2] = rgb[2];
      out[o + 3] = cov[i] * 128;
    } else {
      const v = cov[i] * 255;
      out[o] = v;
      out[o + 1] = v;
      out[o + 2] = v;
      out[o + 3] = 255;
    }
  }
  return out;
}

/**
 * Composite every enabled, non-neutral mask over `frame` — each one is a
 * re-render of `recipe` with the mask's local sliders folded in, blended back
 * through the mask's coverage. Returns a fresh buffer; `frame` is not mutated.
 *
 * `render` re-renders the same source at the same size (the live develop
 * session). It is called only when a mask actually contributes, so a photo with
 * no masks costs nothing beyond the copy.
 *
 * AI (Select Subject) coverage is a computed cache, not parametric: persisted
 * per cacheId and hydrated at startup (subjectMask.ts), so masks survive a
 * relaunch. A mask whose coverage is still missing (write failed, file deleted,
 * browser mode) is skipped — `missingAiCoverage` reports those so the UI can
 * badge them instead of rendering nothing silently.
 */
export function compositeMasks(
  render: (recipe: DevelopRecipeV2) => RenderedFrame,
  recipe: DevelopRecipeV2,
  frame: RenderedFrame,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(frame.rgba);
  const masks = renderableMasks(recipe.masks);
  const aiMasks = recipe.masks.masks.filter((m) => m.enabled && isCachedAiKind(m.components[0]?.kind));
  // Range masks (or range refinements on AI masks) sample the global render;
  // snapshot it once (out is mutated).
  const base = needsBaseImage([...masks, ...aiMasks])
    ? { pixels: new Uint8ClampedArray(frame.rgba), width: frame.width, height: frame.height, depth: frame.depth }
    : undefined;
  // Publish for the on-canvas coverage tint (MaskOverlay), then notify.
  overlayFrame = { width: frame.width, height: frame.height, base };
  for (const fn of overlayListeners) fn();
  for (const m of masks) {
    // A neutral mask (no local adjustment set yet) folds to the base render —
    // skip the extra pass so a still-empty mask doesn't double render cost.
    if (isNeutral(m.adjustments)) continue;
    const mr = render(foldLocalAdjustments(recipe, m.adjustments));
    blendMasked(out, mr.rgba, computeMaskCoverage(m, frame.width, frame.height, base));
  }
  // AI masks: coverage is a computed cache resampled to the frame; maskCoverage
  // folds stacked refinement components + the mask's own invert + opacity in.
  for (const m of aiMasks) {
    if (isNeutral(m.adjustments)) continue;
    const cov = maskCoverage(m, frame.width, frame.height, base);
    if (!cov) continue;
    const mr = render(foldLocalAdjustments(recipe, m.adjustments));
    blendMasked(out, mr.rgba, cov);
  }
  return out;
}

/** Ids of enabled AI masks whose coverage is absent from the cache — they
 *  contribute nothing to any render until Select Subject is re-run. LR's "AI
 *  Edit Status" equivalent: the panel badges these so a stale mask is visible
 *  instead of silent. */
export function missingAiCoverage(recipe: DevelopRecipeV2): string[] {
  const out: string[] = [];
  for (const m of recipe.masks.masks) {
    const c0 = m.components[0];
    if (!m.enabled || (c0?.kind !== "aiSubject" && c0?.kind !== "aiBackground")) continue;
    if (!c0.cacheId || !getSubjectCoverage(c0.cacheId)) out.push(m.id);
  }
  return out;
}

/** Does this recipe have any mask that `compositeMasks` would actually apply?
 *  Used by the native 16-bit route, which renders in Rust and cannot composite. */
export function hasActiveMasks(recipe: DevelopRecipeV2): boolean {
  return recipe.masks.masks.some((m) => m.enabled && !isNeutral(m.adjustments) && m.components.length > 0);
}
