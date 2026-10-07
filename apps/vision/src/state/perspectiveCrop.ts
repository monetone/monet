// ─────────────────────────────────────────────────────────────
// Perspective Crop — pure geometry for Image ▸ Perspective Crop. Engine-free so
// it unit-tests in node; app.ts feeds the result to the engine's
// perspective_crop (rectifies a source quad into a new canvas — the inverse of
// perspective_transform).
//
// The quad corners are expressed as fractions (0..1) of the current canvas, in
// TL, TR, BR, BL order (matching square_to_quad). The default quad is the full
// canvas rect, so a no-change quad at the current size is an identity crop.
// ─────────────────────────────────────────────────────────────

/** One quad corner as a fraction (0..1) of the canvas. */
export interface CropCorner {
  x: number;
  y: number;
}

/** The identity quad: the full canvas rect, corners TL, TR, BR, BL. */
export const FULL_CROP_QUAD: CropCorner[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

/** True when Perspective Crop would preserve both the full quad and canvas size. */
export function isIdentityCrop(corners: CropCorner[], w: number, h: number, outW: number, outH: number): boolean {
  return Math.round(outW) === w && Math.round(outH) === h
    && FULL_CROP_QUAD.every((identity, i) => {
      const corner = corners[i] ?? identity;
      return corner.x === identity.x && corner.y === identity.y;
    });
}

/** Fractional corners → the flat pixel coord list [x0,y0,x1,y1,x2,y2,x3,y3]
 *  (TL,TR,BR,BL) the engine's perspective_crop expects, for a `w`×`h` canvas. */
export function cropQuadPixels(corners: CropCorner[], w: number, h: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < 4; i++) {
    const c = corners[i] ?? FULL_CROP_QUAD[i];
    out.push(c.x * w, c.y * h);
  }
  return out;
}

/** A sensible output size for the crop: the quad's average opposite-edge lengths
 *  in pixels (so the rectified image keeps the subject's rough proportions). */
export function suggestedCropSize(corners: CropCorner[], w: number, h: number): { w: number; h: number } {
  const p = cropQuadPixels(corners, w, h); // [TLx,TLy, TRx,TRy, BRx,BRy, BLx,BLy]
  const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(bx - ax, by - ay);
  const top = dist(p[0], p[1], p[2], p[3]);
  const bottom = dist(p[6], p[7], p[4], p[5]);
  const left = dist(p[0], p[1], p[6], p[7]);
  const right = dist(p[2], p[3], p[4], p[5]);
  return {
    w: Math.max(1, Math.round((top + bottom) / 2)),
    h: Math.max(1, Math.round((left + right) / 2)),
  };
}
