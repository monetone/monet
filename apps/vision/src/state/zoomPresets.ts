// ─────────────────────────────────────────────────────────────
// Zoom presets — pure zoom-ratio math for the Zoom tool's Fit Screen / Fill Screen
// / 100% buttons (Photoshop). Given the viewport and document sizes, compute the
// target zoom. Engine-free so it unit-tests in node; the canvas applies the result
// (centred) via setZoom.
// ─────────────────────────────────────────────────────────────

const MIN_ZOOM = 0.02;
const MAX_ZOOM = 32;

/** Clamp a zoom factor to the supported range [0.02, 32]. */
export function clampZoom(z: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
}

/** Fit the whole document inside the viewport (the smaller ratio, with a small
 *  margin), clamped. Returns 1 for a degenerate document. */
export function fitZoom(vw: number, vh: number, dw: number, dh: number, margin = 0.9): number {
  if (dw <= 0 || dh <= 0) return 1;
  return clampZoom(Math.min(vw / dw, vh / dh) * margin);
}

/** Fill the viewport so the document covers it (the larger ratio), clamped.
 *  Returns 1 for a degenerate document. */
export function fillZoom(vw: number, vh: number, dw: number, dh: number): number {
  if (dw <= 0 || dh <= 0) return 1;
  return clampZoom(Math.max(vw / dw, vh / dh));
}

/** Axis-aligned box of a `dw`×`dh` document after Rotate View and pixel aspect.
 *  Rotation is about the content centre, so the displayed width is
 *  `dw·par·|cos| + dh·|sin|` and the height is `dw·par·|sin| + dh·|cos|`.
 *  Angle 0 and par 1 return the raw document size. */
export function orientedDocSize(dw: number, dh: number, angleDeg: number, par: number): { w: number; h: number } {
  const rad = (angleDeg * Math.PI) / 180;
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  const px = dw * (par > 0 ? par : 1);
  return { w: px * c + dh * s, h: px * s + dh * c };
}

/** Fit a rotated, non-square-pixel document inside the viewport and centre it.
 *  The zoom fits the oriented box; the pan is the unrotated content centre,
 *  which also centres the rotated AABB because rotation is about that centre.
 *  Angle 0 and par 1 match `fitZoom` plus the historical centred pan. */
export function fitOrientedView(
  vw: number, vh: number, dw: number, dh: number, angleDeg: number, par: number, margin = 0.9,
): { zoom: number; panX: number; panY: number } {
  if (dw <= 0 || dh <= 0 || vw <= 0 || vh <= 0) return { zoom: 1, panX: 0, panY: 0 };
  const box = orientedDocSize(dw, dh, angleDeg, par);
  const zoom = fitZoom(vw, vh, box.w, box.h, margin);
  const aspect = par > 0 ? par : 1;
  return {
    zoom,
    panX: (vw - dw * zoom * aspect) / 2,
    panY: (vh - dh * zoom) / 2,
  };
}

/** Fit an inclusive canvas-space rect [minx,miny,maxx,maxy] inside the viewport
 *  and centre it: the zoom fits the rect (with the same margin as fitZoom), the
 *  pan places the rect's centre at the viewport centre. `setZoom` draws canvas
 *  point (x,y) at (panX + x·z, panY + y·z). Powers Fit Layer(s) on Screen. */
export function fitRectView(
  vw: number, vh: number, minx: number, miny: number, maxx: number, maxy: number, margin = 0.9,
): { zoom: number; panX: number; panY: number } {
  const rw = maxx - minx + 1; // inclusive bounds → span
  const rh = maxy - miny + 1;
  const zoom = fitZoom(vw, vh, rw, rh, margin);
  const cx = (minx + maxx + 1) / 2; // rect centre in canvas space
  const cy = (miny + maxy + 1) / 2;
  return { zoom, panX: vw / 2 - cx * zoom, panY: vh / 2 - cy * zoom };
}
