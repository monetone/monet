// Artboard tool (Photoshop) — pure geometry/preset/orientation helpers. The
// engine owns the artboard container (kind=6 with [x,y,w,h] adj_params + white
// background); these node-testable leaves turn a drag into an artboard rect,
// resolve a size preset + orientation, and locate the body/handles for
// select/move/resize. DOM/WASM-free so they run under vitest. The select/move/
// resize maths is identical to a slice's (an {x,y,w,h} rectangle with 8 handles)
// and the drag maths to a frame's, so this reuses those leaves rather than
// duplicating them.

import { DOC_PRESETS, type DocPreset } from "./docPresets";
import { frameRect, type Rect } from "./frameTool";
import {
  hitTestSlice, hitTestHandle, moveSliceBy, resizeSliceTo, sliceHandles,
} from "./slices";

export type { Rect, DocPreset };
export type Orientation = "portrait" | "landscape";

/** Device/print size presets for the Artboard tool options bar (reuses the New
 *  Document preset list — same px-based device/web/print sizes). */
export const ARTBOARD_PRESETS = DOC_PRESETS;

/** Below this on either axis an Artboard-tool drag is treated as a click (which
 *  selects/deselects), not a new artboard. */
export const MIN_ARTBOARD = 8;

/** Orient a (w,h) pair: landscape → width ≥ height, portrait → height ≥ width.
 *  Swaps the pair when it doesn't already match the requested orientation. */
export function orientSize(w: number, h: number, o: Orientation): { w: number; h: number } {
  const long = Math.max(w, h);
  const short = Math.min(w, h);
  return o === "landscape" ? { w: long, h: short } : { w: short, h: long };
}

/** Resolve a preset name + orientation to a pixel size, or undefined when the
 *  name matches no preset. */
export function presetSize(name: string, o: Orientation): { w: number; h: number } | undefined {
  const p = ARTBOARD_PRESETS.find((q) => q.name === name);
  return p ? orientSize(p.w, p.h, o) : undefined;
}

/** Normalise an Artboard-tool drag into an integer rect — Shift constrains to a
 *  square, Alt grows from the start point (reuses the Frame tool's drag maths). */
export function artboardRect(
  sx: number,
  sy: number,
  ex: number,
  ey: number,
  square: boolean,
  fromCenter: boolean,
): Rect {
  return frameRect(sx, sy, ex, ey, square, fromCenter);
}

/** A drag only creates an artboard when it's a real rectangle, not a click. */
export function artboardDragIsValid(w: number, h: number): boolean {
  return w >= MIN_ARTBOARD && h >= MIN_ARTBOARD;
}

// Select/move/resize reuse the slice geometry (identical {x,y,w,h} rectangles +
// 8 clockwise-from-TL handles). Aliased so callers read in artboard terms.
export const artboardHandles = sliceHandles;
export const hitTestArtboard = hitTestSlice;
export const hitTestArtboardHandle = hitTestHandle;
export const moveArtboardBy = moveSliceBy;
export const resizeArtboardTo = resizeSliceTo;
