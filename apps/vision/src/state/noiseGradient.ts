// Noise gradient (Gradient tool ▸ Noise type). Instead of interpolating between
// hand-placed colour stops, a noise gradient fills the ramp with pseudo-random
// colours; Roughness controls how many abrupt colour bands appear, and each
// Randomize reseeds. It's generated as ordinary gradient stops, so the existing
// gradient_fill pipeline applies it unchanged. Deterministic (seeded) + pure so
// it unit-tests in node.
import type { GradientStop } from "./store";

/** A seeded noise ramp of gradient stops. `roughness` 0..1 raises the number of
 *  distinct colour bands (0 ≈ a smooth 2-colour blend, 1 ≈ many hard bands). */
export function noiseGradientStops(seed: number, roughness: number, maxBands = 32): GradientStop[] {
  const r = Math.max(0, Math.min(1, roughness));
  const n = Math.max(2, Math.round(2 + r * (maxBands - 2)));
  let s = (seed >>> 0) || 1;
  const rand = (): number => {
    // LCG (Numerical Recipes constants) — deterministic per seed.
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const stops: GradientStop[] = [];
  for (let i = 0; i < n; i++) {
    stops.push({
      pos: i / (n - 1),
      r: Math.round(rand() * 255),
      g: Math.round(rand() * 255),
      b: Math.round(rand() * 255),
      a: 255,
    });
  }
  return stops;
}
