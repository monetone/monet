// Spot Healing Brush — pure & node-safe (no engine/DOM). Maps the painted dab
// centers into ellipse selection rects that build the "spot" footprint; the store
// then content-aware-fills that footprint from its surroundings (the heal).
//
// Photoshop's Spot Healing Brush removes a blemish by sampling the SURROUNDINGS of
// the painted area — no manual source point (that's the Healing Brush).
//   https://helpx.adobe.com/photoshop/using/retouching-repairing-images.html

export interface DabRect {
  x: number;
  y: number;
  w: number;
  h: number;
  mode: number; // 0 = Replace (first dab), 1 = Add (rest) — builds the painted footprint
}

/** Map a flat list of dab centers [x0,y0,x1,y1,…] + a brush radius into ellipse
 *  selection rects. The first dab replaces the selection; the rest add to it, so
 *  the union is the full painted footprint. Returns [] when there are no points. */
export function spotHealDabs(points: number[], radius: number): DabRect[] {
  const r = Math.max(1, Math.round(radius));
  const out: DabRect[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) {
    out.push({
      x: Math.round(points[i] - r),
      y: Math.round(points[i + 1] - r),
      w: r * 2,
      h: r * 2,
      mode: out.length === 0 ? 0 : 1,
    });
  }
  return out;
}
