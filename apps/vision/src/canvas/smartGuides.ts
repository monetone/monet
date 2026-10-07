// Smart Guides snap math (pure + unit-tested). Given the rectangle being dragged
// and the static layer rectangles, find the offset that aligns the moving rect's
// edges/centres to a nearby static edge/centre within a threshold, plus the
// alignment guide lines to draw.

export interface Rect { x: number; y: number; w: number; h: number; }
export interface SmartResult { dx: number; dy: number; guides: { o: "v" | "h"; p: number; from: number; to: number }[]; }

const xs = (r: Rect) => [r.x, r.x + r.w / 2, r.x + r.w]; // left, centre, right
const ys = (r: Rect) => [r.y, r.y + r.h / 2, r.y + r.h]; // top, middle, bottom

export function smartSnap(moving: Rect, others: Rect[], threshold: number): SmartResult {
  const mxs = xs(moving), mys = ys(moving);
  let bestDx = 0, bestDxDist = threshold + 1;
  let bestDy = 0, bestDyDist = threshold + 1;
  for (const o of others) {
    for (const mx of mxs) for (const ox of xs(o)) {
      const d = ox - mx;
      if (Math.abs(d) <= threshold && Math.abs(d) < bestDxDist) { bestDx = d; bestDxDist = Math.abs(d); }
    }
    for (const my of mys) for (const oy of ys(o)) {
      const d = oy - my;
      if (Math.abs(d) <= threshold && Math.abs(d) < bestDyDist) { bestDy = d; bestDyDist = Math.abs(d); }
    }
  }
  // Record guide lines where the snapped rect's edges/centres coincide.
  const sm: Rect = { x: moving.x + bestDx, y: moving.y + bestDy, w: moving.w, h: moving.h };
  const guides: SmartResult["guides"] = [];
  for (const o of others) {
    for (const mx of xs(sm)) for (const ox of xs(o)) if (Math.abs(mx - ox) < 0.5) {
      guides.push({ o: "v", p: ox, from: Math.min(sm.y, o.y), to: Math.max(sm.y + sm.h, o.y + o.h) });
    }
    for (const my of ys(sm)) for (const oy of ys(o)) if (Math.abs(my - oy) < 0.5) {
      guides.push({ o: "h", p: oy, from: Math.min(sm.x, o.x), to: Math.max(sm.x + sm.w, o.x + o.w) });
    }
  }
  return { dx: bestDx, dy: bestDy, guides };
}
