// ─────────────────────────────────────────────────────────────
// transform.ts — pure transform operations.
//
// Unity's Transform component has a context-menu "Reset" that zeroes position +
// rotation and sets scale back to 1; per-property resets (Position / Rotation /
// Scale) are a popular convenience too. It also supports "Copy Component" /
// "Paste Component Values" — copying position/rotation/scale and pasting them
// onto another object. Jouer mirrors both. Origin and alpha are NOT part of
// Unity's Transform (origin is a Jouer concept, alpha lives on the renderer), so
// reset and paste always preserve them.
//
// Nothing in this module imports React, Phaser, or the DOM.
// ─────────────────────────────────────────────────────────────

import type { Transform } from "./types";

export type ResetTarget = "all" | "position" | "rotation" | "scale";

// ── Pivot presets (Unity Sprite Editor's pivot dropdown) ──────────────────────
/** The nine standard pivot positions. */
export type OriginPreset =
  | "top-left" | "top" | "top-right"
  | "left" | "center" | "right"
  | "bottom-left" | "bottom" | "bottom-right";

/** Pivot presets as origin x/y in 0..1 with (0,0) = top-left — Jouer's origin
 *  convention (Phaser). Mirrors Unity's Sprite Editor pivot dropdown. */
export const ORIGIN_PRESETS: Record<OriginPreset, { x: number; y: number }> = {
  "top-left": { x: 0, y: 0 }, top: { x: 0.5, y: 0 }, "top-right": { x: 1, y: 0 },
  left: { x: 0, y: 0.5 }, center: { x: 0.5, y: 0.5 }, right: { x: 1, y: 0.5 },
  "bottom-left": { x: 0, y: 1 }, bottom: { x: 0.5, y: 1 }, "bottom-right": { x: 1, y: 1 },
};

/** The preset matching an origin (within `eps`), or null for a custom origin —
 *  used to highlight the active cell in the pivot picker. */
export function presetForOrigin(originX: number, originY: number, eps = 1e-3): OriginPreset | null {
  for (const name of Object.keys(ORIGIN_PRESETS) as OriginPreset[]) {
    const p = ORIGIN_PRESETS[name];
    if (Math.abs(p.x - originX) < eps && Math.abs(p.y - originY) < eps) return name;
  }
  return null;
}

/** The position/rotation/scale of a transform — Unity's Transform-component
 *  values, excluding origin + alpha. */
export interface TransformValues {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  angle: number;
}

/** Snapshot a transform's copyable values (Unity's "Copy Component"). */
export function pickTransformValues(t: Transform): TransformValues {
  return { x: t.x, y: t.y, scaleX: t.scaleX, scaleY: t.scaleY, angle: t.angle };
}

/** Apply copied values onto a transform (Unity's "Paste Component Values"),
 *  preserving origin + alpha. */
export function applyTransformValues(t: Transform, v: TransformValues): Transform {
  return { ...t, x: v.x, y: v.y, scaleX: v.scaleX, scaleY: v.scaleY, angle: v.angle };
}

/** A copy of `t` with the requested component(s) reset to identity (position 0,
 *  rotation 0, scale 1). `originX`, `originY` and `alpha` always pass through. */
export function resetTransformValues(t: Transform, target: ResetTarget = "all"): Transform {
  const out: Transform = { ...t };
  if (target === "all" || target === "position") {
    out.x = 0;
    out.y = 0;
  }
  if (target === "all" || target === "rotation") {
    out.angle = 0;
  }
  if (target === "all" || target === "scale") {
    out.scaleX = 1;
    out.scaleY = 1;
  }
  return out;
}

/** A scale-only patch (one or both axes). */
export type ScalePatch = { scaleX?: number; scaleY?: number };

/** Expand a single-axis scale edit so the other axis keeps the aspect ratio
 *  (Unity's "Constrain Proportions"). A two-axis or empty patch is returned
 *  unchanged. If the edited axis's OLD value is 0 the ratio is undefined, so only
 *  the edited axis is set (the other can't be derived). */
export function constrainScale(t: Transform, patch: ScalePatch): ScalePatch {
  const hasX = patch.scaleX !== undefined;
  const hasY = patch.scaleY !== undefined;
  if (hasX === hasY) return patch; // both or neither — nothing to constrain
  if (hasX) {
    const r = t.scaleX !== 0 ? patch.scaleX! / t.scaleX : null;
    return r === null ? { scaleX: patch.scaleX } : { scaleX: patch.scaleX, scaleY: t.scaleY * r };
  }
  const r = t.scaleY !== 0 ? patch.scaleY! / t.scaleY : null;
  return r === null ? { scaleY: patch.scaleY } : { scaleY: patch.scaleY, scaleX: t.scaleX * r };
}
