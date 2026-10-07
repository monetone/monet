// loupeZoom — the pure transform math for the Library Loupe's zoom/pan (Lightroom
// clicks to toggle Fit ↔ 1:1 at the clicked point, then drags to pan). The image
// is drawn at its natural pixel size with `transform-origin: 0 0` and
// `translate(pan) scale(scale)`, so an image pixel (ix,iy) lands at
// (pan.x + ix·scale, pan.y + iy·scale). Kept pure so the geometry is unit-tested.

export interface Pan {
  x: number;
  y: number;
}

/** Scale that fits imgW×imgH inside viewW×viewH (contain). */
export function fitScale(imgW: number, imgH: number, viewW: number, viewH: number): number {
  if (imgW <= 0 || imgH <= 0) return 1;
  return Math.min(viewW / imgW, viewH / imgH);
}

/** Pan (top-left translate) that centers the scaled image in the viewport. */
export function centerPan(imgW: number, imgH: number, scale: number, viewW: number, viewH: number): Pan {
  return { x: (viewW - imgW * scale) / 2, y: (viewH - imgH * scale) / 2 };
}

/** Clamp pan so a scaled image larger than the viewport keeps covering it (no
 *  empty gaps at the edges); a smaller one is centered on that axis. */
export function clampPan(pan: Pan, imgW: number, imgH: number, scale: number, viewW: number, viewH: number): Pan {
  const axis = (p: number, scaled: number, view: number): number => {
    if (scaled <= view) return (view - scaled) / 2; // center when smaller than the view
    return Math.min(0, Math.max(view - scaled, p)); // keep within [view - scaled, 0]
  };
  return {
    x: axis(pan.x, imgW * scale, viewW),
    y: axis(pan.y, imgH * scale, viewH),
  };
}

/** Pan that puts the natural-relative image point (nx, ny ∈ 0..1) at the view
 *  centre, clamped — the Compare view's synced zoom derives each pane's pan
 *  from one shared focal point this way. */
export function panForFocus(
  nx: number,
  ny: number,
  imgW: number,
  imgH: number,
  scale: number,
  viewW: number,
  viewH: number,
): Pan {
  const pan = { x: viewW / 2 - nx * imgW * scale, y: viewH / 2 - ny * imgH * scale };
  return clampPan(pan, imgW, imgH, scale, viewW, viewH);
}

/** Rescale a zoom state when the SAME content arrives at a different decode
 *  resolution (the Loupe's progressive 1:1 upgrade): the content keeps its
 *  visual size and position — only what "scale 1" means changes. The pan is a
 *  screen-space translate of the content's top-left corner, so it carries
 *  over unchanged (then clamps against the new pixel dimensions). */
export function rescaleZoom(
  zoom: { scale: number; pan: Pan },
  oldW: number,
  newW: number,
  newH: number,
  viewW: number,
  viewH: number,
): { scale: number; pan: Pan } {
  if (oldW <= 0 || newW <= 0) return zoom;
  const scale = zoom.scale * (oldW / newW);
  return { scale, pan: clampPan(zoom.pan, newW, newH, scale, viewW, viewH) };
}

/** The Loupe's 1:1 target scale for the CURRENTLY loaded decode: show the
 *  photo at `targetEdge` pixels on its long side (the largest decode the
 *  pipeline delivers — native, or the RAW proxy ceiling). >1 upscales a
 *  fit-sized decode (soft until that decode swaps in); photos at or under
 *  the decode edge cap at true 1:1. targetEdge 0 = decode-relative 1:1. */
export function detailScale(natW: number, natH: number, targetEdge: number): number {
  const nat = Math.max(natW, natH);
  if (nat <= 0 || targetEdge <= 0) return 1;
  return Math.max(1, targetEdge / nat);
}

/** Zoom to `scale`, keeping the viewport point (cx, cy) over the same image pixel
 *  it was on, then clamp the pan. */
export function zoomToPoint(
  cx: number,
  cy: number,
  prevScale: number,
  prevPan: Pan,
  scale: number,
  imgW: number,
  imgH: number,
  viewW: number,
  viewH: number,
): { scale: number; pan: Pan } {
  // Image pixel currently under the cursor.
  const ix = (cx - prevPan.x) / prevScale;
  const iy = (cy - prevPan.y) / prevScale;
  const pan = { x: cx - ix * scale, y: cy - iy * scale };
  return { scale, pan: clampPan(pan, imgW, imgH, scale, viewW, viewH) };
}
