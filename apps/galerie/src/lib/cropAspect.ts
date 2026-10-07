// cropAspect — Lightroom-style crop aspect-ratio presets. Picking a ratio sets a
// centered, maximal-fit crop rect of that ratio (a one-shot "set to aspect"; the
// persistent lock-on-drag is a follow-up). Kept pure so the geometry is unit-
// tested; CropOverlay renders a dropdown over it.

export interface AspectPreset {
  label: string;
  /** Target crop ratio in image pixels (width / height). */
  ratio: number;
}

// The common Lightroom crop ratios (landscape orientation; the image aspect
// converts them to normalized space, so a portrait image still gets a valid crop).
export const CROP_ASPECTS: readonly AspectPreset[] = [
  { label: "1:1", ratio: 1 },
  { label: "2:3", ratio: 2 / 3 },
  { label: "3:4", ratio: 3 / 4 },
  { label: "4:5", ratio: 4 / 5 },
  { label: "5:7", ratio: 5 / 7 },
  { label: "16:9", ratio: 16 / 9 },
];

export interface CropRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The largest centered rect of normalized aspect `na` (width/height) that fits
 *  the unit square. `na >= 1` is width-bound; `na < 1` is height-bound. A
 *  non-positive / non-finite `na` falls back to the full frame. */
export function fitUnitRect(na: number): CropRect {
  if (!(na > 0) || !Number.isFinite(na)) return { left: 0, top: 0, right: 1, bottom: 1 };
  if (na >= 1) {
    const h = 1 / na;
    const m = (1 - h) / 2;
    return { left: 0, top: m, right: 1, bottom: 1 - m };
  }
  const m = (1 - na) / 2;
  return { left: m, top: 0, right: 1 - m, bottom: 1 };
}

/** The crop rect (normalized image space) for a target pixel `ratio` (width/height)
 *  on an image of pixel aspect `imageAspect` (width/height). A crop of pixel ratio
 *  R needs normalized aspect R / imageAspect, since the rect's pixel aspect is
 *  `(normWidth/normHeight)·imageAspect`. */
export function aspectCropRect(ratio: number, imageAspect: number): CropRect {
  const na = imageAspect > 0 && Number.isFinite(imageAspect) ? ratio / imageAspect : ratio;
  return fitUnitRect(na);
}

/** Minimum normalized crop extent — keeps a locked drag from collapsing the rect. */
const MIN_EXTENT = 0.05;

/** A corner drag constrained to normalized aspect `na` (width/height): the fixed
 *  (diagonally-opposite) corner is `(fx, fy)`, the dragged corner targets
 *  `(mx, my)`. The rect keeps aspect `na`, sizes to reach the pointer along its
 *  dominant axis, floors to a minimum, and shrinks (aspect-preserving) to stay in
 *  the unit square. All coordinates normalized 0..1. */
export function constrainRectToAspect(fx: number, fy: number, mx: number, my: number, na: number): CropRect {
  const a = na > 0 && Number.isFinite(na) ? na : 1;
  const dx = mx - fx;
  const dy = my - fy;
  const sx = dx >= 0 ? 1 : -1;
  const sy = dy >= 0 ? 1 : -1;
  let w = Math.abs(dx);
  let h = Math.abs(dy);
  // Match the aspect using the larger extent so the corner reaches the pointer.
  if (w >= h * a) h = w / a;
  else w = h * a;
  // Floor so the crop can't collapse to nothing.
  if (w < MIN_EXTENT) {
    w = MIN_EXTENT;
    h = w / a;
  }
  if (h < MIN_EXTENT) {
    h = MIN_EXTENT;
    w = h * a;
  }
  // Shrink (keeping the aspect) to stay within [0,1] from the fixed corner.
  const maxW = sx > 0 ? 1 - fx : fx;
  const maxH = sy > 0 ? 1 - fy : fy;
  const scale = Math.min(1, w > 0 ? maxW / w : 1, h > 0 ? maxH / h : 1);
  w *= scale;
  h *= scale;
  return {
    left: sx > 0 ? fx : fx - w,
    right: sx > 0 ? fx + w : fx,
    top: sy > 0 ? fy : fy - h,
    bottom: sy > 0 ? fy + h : fy,
  };
}
