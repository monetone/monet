// ─────────────────────────────────────────────────────────────
// View transform — where a document sits in a canvas viewport, for the main
// canvas and every Window ▸ Arrange pane alike. The content is scaled by zoom
// (× the pixel aspect on x), turned by Rotate View about its own centre, then
// offset by pan:  screen = pan + Z·C + R·Z·(d − C),  C the document centre.
// Engine-free so it unit-tests in node.
// ─────────────────────────────────────────────────────────────

export interface DocView {
  zoom: number;
  panX: number;
  panY: number;
  rotationAngle: number; // Rotate View, degrees
}

/** A view together with the viewport and document it maps between. */
export interface PlacedView extends DocView {
  viewport: { w: number; h: number };
  docW: number;
  docH: number;
}

/** The CSS transform that puts a `docW`×`docH` box where `v` shows the
 *  document (transform-origin 0 0). Reduces to the plain translate·scale at
 *  angle 0, so the unrotated case is pixel-identical. */
export function viewCss(v: DocView, par: number, docW: number, docH: number): string {
  const cx = (docW / 2) * v.zoom * par, cy = (docH / 2) * v.zoom;
  return `translate(${v.panX}px, ${v.panY}px) translate(${cx}px, ${cy}px) rotate(${v.rotationAngle}deg) translate(${-cx}px, ${-cy}px) scale(${v.zoom * par}, ${v.zoom})`;
}

/** Viewport point (px from its top-left) → document point. */
export function docPointAt(
  v: DocView, par: number, docW: number, docH: number, sx: number, sy: number,
): { x: number; y: number } {
  const zx = v.zoom * par, zy = v.zoom;
  // Rotate View: undo the view rotation (about the content centre) before the
  // plain inverse. A no-op at angle 0, so all existing mapping is unchanged.
  const ang = v.rotationAngle;
  if (ang) {
    const pvx = v.panX + (docW / 2) * zx;
    const pvy = v.panY + (docH / 2) * zy;
    const r = -ang * Math.PI / 180, ca = Math.cos(r), sa = Math.sin(r);
    const dx = sx - pvx, dy = sy - pvy;
    sx = ca * dx - sa * dy + pvx;
    sy = sa * dx + ca * dy + pvy;
  }
  return { x: (sx - v.panX) / zx, y: (sy - v.panY) / zy };
}

/** The pan that shows document point `d` at viewport point (sx, sy). */
export function panToShow(
  zoom: number, rotationAngle: number, par: number, docW: number, docH: number,
  d: { x: number; y: number }, sx: number, sy: number,
): { panX: number; panY: number } {
  const zx = zoom * par, zy = zoom;
  const ox = (d.x - docW / 2) * zx, oy = (d.y - docH / 2) * zy;
  const r = rotationAngle * Math.PI / 180, ca = Math.cos(r), sa = Math.sin(r);
  return {
    panX: sx - (docW / 2) * zx - (ca * ox - sa * oy),
    panY: sy - (docH / 2) * zy - (sa * ox + ca * oy),
  };
}

/** Window ▸ Arrange ▸ Match Zoom / Location / Rotation: `dst` takes `src`'s
 *  zoom and rotation where asked. Match Location centres `dst` on the document
 *  point at the centre of `src`; otherwise `dst` keeps its own centre point
 *  still, so a matched zoom or rotation turns about the middle of the pane. */
export function matchedView(
  src: PlacedView, dst: PlacedView,
  flags: { zoom?: boolean; location?: boolean; rotation?: boolean }, par = 1,
): DocView {
  const zoom = flags.zoom ? src.zoom : dst.zoom;
  const rotationAngle = flags.rotation ? src.rotationAngle : dst.rotationAngle;
  const from = flags.location ? src : dst;
  const d = docPointAt(from, par, from.docW, from.docH, from.viewport.w / 2, from.viewport.h / 2);
  return { zoom, rotationAngle, ...panToShow(zoom, rotationAngle, par, dst.docW, dst.docH, d, dst.viewport.w / 2, dst.viewport.h / 2) };
}
