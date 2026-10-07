// Marching ants, shared by every canvas view and the Window ▸ Arrange float
// windows (#477): each selection-boundary pixel black or white in 4-px runs
// that walk one step per frame.

/** One view's reusable ants buffer: an ImageData over the boundary's bounding
 *  box, rebuilt only when the boundary itself changes — not allocated
 *  (W·H·4 ≈ 96 MB on a large doc) on every animation frame. */
export interface AntsCache { pts: Int32Array | null; img: ImageData | null; x: number; y: number }
export const antsCache = (): AntsCache => ({ pts: null, img: null, x: 0, y: 0 });

/** Draw boundary `pts` (x, y pairs) at `phase` (0..7); only the bbox is blitted. */
export function drawAnts(ctx: CanvasRenderingContext2D, pts: Int32Array, phase: number, cache: AntsCache) {
  if (!pts.length) return;
  if (cache.pts !== pts || !cache.img) {
    let minX = Infinity, minY = Infinity, maxX = 0, maxY = 0;
    for (let i = 0; i < pts.length; i += 2) {
      const x = pts[i], y = pts[i + 1];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    cache.img = ctx.createImageData(maxX - minX + 1, maxY - minY + 1);
    cache.x = minX;
    cache.y = minY;
    cache.pts = pts;
  }
  const { img, x: bx, y: by } = cache;
  const d = img.data;
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i], y = pts[i + 1];
    const v = ((x + y + phase) >> 2) & 1 ? 255 : 0;
    const p = ((y - by) * img.width + (x - bx)) * 4;
    d[p] = v;
    d[p + 1] = v;
    d[p + 2] = v;
    d[p + 3] = 255;
  }
  ctx.putImageData(img, bx, by);
}
