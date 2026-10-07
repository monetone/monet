// ─────────────────────────────────────────────────────────────
// Navigator geometry — pure math for the Navigator panel (Photoshop). Maps the
// canvas pan/zoom + viewport size to the document region currently visible, and
// to the red "view box" drawn over the thumbnail. Engine-free so it unit-tests in
// node; the panel reads zoom/pan/viewport from the store and the thumbnail from
// EngineClient.docThumbUrl().
//
// Canvas transform: a doc point (dx,dy) lands on screen at
//   screenX = panX + dx*zoom*parX,  screenY = panY + dy*zoom
// (see CanvasView toScreen / screen→doc), so the viewport's top-left maps back to
// doc (-panX/zoom, -panY/zoom) and it spans vw/zoom × vh/zoom doc pixels.
// ─────────────────────────────────────────────────────────────

export interface NavRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The document-space rectangle currently visible in the viewport. */
export function visibleDocRect(zoom: number, panX: number, panY: number, vw: number, vh: number, parX = 1): NavRect {
  if (zoom <= 0 || parX <= 0) return { x: 0, y: 0, w: 0, h: 0 };
  const zx = zoom * parX;
  // `panX === 0 ? 0 : …` avoids a -0 origin (cosmetic, keeps toEqual happy).
  return { x: panX === 0 ? 0 : -panX / zx, y: panY === 0 ? 0 : -panY / zoom, w: vw / zx, h: vh / zoom };
}

/** Thumbnail dimensions for a doc fit (contain) into a box, never upscaling —
 *  mirrors EngineClient.docThumbUrl's scale = min(boxW/w, boxH/h, 1). */
export function thumbBox(docW: number, docH: number, boxW: number, boxH: number): { w: number; h: number; scale: number } {
  if (docW <= 0 || docH <= 0) return { w: 0, h: 0, scale: 0 };
  const scale = Math.min(boxW / docW, boxH / docH, 1);
  return { w: Math.max(1, Math.round(docW * scale)), h: Math.max(1, Math.round(docH * scale)), scale };
}

/** Map the visible doc rect into thumbnail pixel coords, clamped fully inside the
 *  thumbnail (the view box never spills past the image edge, as in Photoshop). */
export function viewRectInThumb(vis: NavRect, docW: number, docH: number, tw: number, th: number): NavRect {
  if (docW <= 0 || docH <= 0) return { x: 0, y: 0, w: 0, h: 0 };
  const sx = tw / docW;
  const sy = th / docH;
  const x0 = Math.max(0, Math.min(tw, vis.x * sx));
  const y0 = Math.max(0, Math.min(th, vis.y * sy));
  const x1 = Math.max(0, Math.min(tw, (vis.x + vis.w) * sx));
  const y1 = Math.max(0, Math.min(th, (vis.y + vis.h) * sy));
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

/** Pan offsets so doc point (docX,docY) sits at the viewport centre. */
export function panForCenter(docX: number, docY: number, zoom: number, vw: number, vh: number, parX = 1): { panX: number; panY: number } {
  return { panX: vw / 2 - docX * zoom * parX, panY: vh / 2 - docY * zoom };
}
