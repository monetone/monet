// healSpots — pure geometry for the Develop Heal tool (Lightroom's spot
// removal). Spots live on the recipe (recipe.heal.spots) in normalized
// un-cropped source coordinates; the engine renders them (develop_heal_spots),
// with the radius normalized against min(width, height).

import type { HealSpot } from "@monet-ui/monet-photo";

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export const DEFAULT_HEAL_RADIUS = 0.025;

/** A new spot at (x, y): the sample source starts offset horizontally toward
 *  the image centre — clear of the blemish, biased into same-context pixels.
 *  Pure geometry; the overlay upgrades this to a patch-matched source
 *  (`pickHealSource`) as soon as it has a rendered frame. */
export function placeHealSpot(x: number, y: number, radius = DEFAULT_HEAL_RADIUS): HealSpot {
  const dx = x <= 0.5 ? 1 : -1;
  const off = Math.max(radius * 3, 0.06);
  return {
    mode: "heal",
    x: clamp01(x),
    y: clamp01(y),
    sourceX: clamp01(x + dx * off),
    sourceY: clamp01(y),
    radius,
    feather: 0.5,
    opacity: 1,
  };
}

/** Per-axis scale that turns normalized 0..1 deltas into the engine's
 *  min-dimension units for a display of the given width/height `aspect`. */
function minDimScale(aspect: number): { ax: number; ay: number } {
  return aspect >= 1 ? { ax: aspect, ay: 1 } : { ax: 1, ay: 1 / aspect };
}

/** The spot handle (target or source circle) under (x, y), topmost (most
 *  recently placed) first; null when nothing is close enough. */
export function hitHealSpot(
  spots: readonly HealSpot[],
  x: number,
  y: number,
  aspect: number,
): { index: number; handle: "target" | "source" } | null {
  const { ax, ay } = minDimScale(aspect);
  const MIN_HIT = 0.015; // tiny spots stay grabbable
  for (let i = spots.length - 1; i >= 0; i--) {
    const s = spots[i];
    const hit = Math.max(s.radius, MIN_HIT);
    if (Math.hypot((x - s.x) * ax, (y - s.y) * ay) <= hit) return { index: i, handle: "target" };
    if (Math.hypot((x - s.sourceX) * ax, (y - s.sourceY) * ay) <= hit) return { index: i, handle: "source" };
  }
  return null;
}

/** SVG ellipse radii that draw an engine radius (min-dimension units) as a
 *  circle on screen inside a `viewBox="0 0 1 1"` stretched to `aspect`. */
export function healEllipseRadii(radius: number, aspect: number): { rx: number; ry: number } {
  return aspect >= 1 ? { rx: radius / aspect, ry: radius } : { rx: radius, ry: radius * aspect };
}
