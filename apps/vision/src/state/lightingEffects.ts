// ─────────────────────────────────────────────────────────────
// Lighting Effects — pure param builder for Filter ▸ Render ▸ Lighting Effects.
// Engine-free so it unit-tests in node; app.ts feeds the result to the engine's
// filter_lighting_effects (a single point light over a luminance-bump surface).
// ─────────────────────────────────────────────────────────────

/** Photoshop's Light Type selector. */
export const LIGHT_TYPES = ["Point", "Spot", "Infinite"] as const;

export interface LightingOptions {
  x: number; // light X, percent of canvas width (0..100)
  y: number; // light Y, percent of canvas height (0..100)
  height: number; // light height above the plane, percent of the smaller canvas dim
  intensity: number; // diffuse strength (0..3)
  ambient: number; // fill light (0..1)
  bump: number; // surface-relief amount (0..4); 0 = flat (no texture)
  color: { r: number; g: number; b: number }; // light colour, 0..255
  lightType?: number; // 0 Point (omni), 1 Spot (cone), 2 Infinite (directional); default Point
}

export const DEFAULT_LIGHTING: LightingOptions = {
  x: 50,
  y: 50,
  height: 60,
  intensity: 1.2,
  ambient: 0.25,
  bump: 1,
  color: { r: 255, g: 255, b: 255 },
  lightType: 0,
};

/** The engine arg tuple for filter_lighting_effects:
 *  [lx, ly, lz, intensity, ambient, bump, r, g, b, lightType] — positions in
 *  CANVAS pixels (the light is placed on the document; `filter_lighting_effects`
 *  shifts it into the layer's plane space itself, see #42), colour 0..1,
 *  lightType 0/1/2. */
export type LightingArgs = [number, number, number, number, number, number, number, number, number, number];

/** Map UI options + canvas size to the engine arg tuple. Light height is a
 *  percent of the smaller canvas dimension so the look is resolution-independent;
 *  `lz` is floored at 1px so a zero height still gives a valid light vector. */
export function lightingArgs(o: LightingOptions, w: number, h: number): LightingArgs {
  const lz = Math.max(1, (o.height / 100) * Math.min(w, h));
  return [
    (o.x / 100) * w,
    (o.y / 100) * h,
    lz,
    o.intensity,
    o.ambient,
    o.bump,
    o.color.r / 255,
    o.color.g / 255,
    o.color.b / 255,
    o.lightType ?? 0,
  ];
}
