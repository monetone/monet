// Layer ▸ Copy CSS — the drop-shadow half, kept pure so it is node-testable
// (app.ts pulls the WASM engine and cannot be imported by a unit test).
//
// Layer effects are a MULTISET: a layer can carry several drop shadows. CSS
// `box-shadow` is a comma-separated list, so a stacked style maps onto it
// directly — the whole-type read this replaced saw only instance 0 and silently
// dropped every shadow after the first.

/** Drop-shadow param layout (FX_DEFS id 0), as `set_layer_effect_at` stores it. */
const ENABLED = 0, OPACITY = 2, R = 3, G = 4, B = 5, ANGLE = 6, DISTANCE = 7, SIZE = 9;

/** One `box-shadow` term, or null when the instance is disabled or malformed. */
export function boxShadowTerm(p: readonly number[]): string | null {
  if (p.length < 10 || (p[ENABLED] ?? 0) <= 0.5) return null;
  const angle = (p[ANGLE] * Math.PI) / 180;
  // (#131) Mirror the engine's offset_px (raster/effects.rs): angle is the LIGHT
  // direction and the shadow falls away from it, so dx = -cos·d; screen y grows
  // downward, so dy = +sin·d. Both were negated here — the pasted box-shadow
  // pointed 180° opposite to the rendered one.
  const dx = Math.round(-Math.cos(angle) * p[DISTANCE]);
  const dy = Math.round(Math.sin(angle) * p[DISTANCE]);
  const rgb = [R, G, B].map((i) => Math.round(p[i] * 255)).join(", ");
  return `${dx}px ${dy}px ${Math.round(p[SIZE])}px rgba(${rgb}, ${p[OPACITY].toFixed(2)})`;
}

/** The full `box-shadow` value for a layer's drop-shadow instances, in stack
 *  order, or null when none are enabled. */
export function boxShadowValue(instances: readonly (readonly number[])[]): string | null {
  const terms: string[] = [];
  for (const p of instances) {
    const term = boxShadowTerm(p);
    if (term !== null) terms.push(term);
  }
  return terms.length > 0 ? terms.join(", ") : null;
}
