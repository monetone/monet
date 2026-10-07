// ─────────────────────────────────────────────────────────────
// Skin Smoothing (Filter ▸ Neural Filters ▸ Skin Smoothing, VIS-FX-13) —
// heuristic parity with Photoshop's Featured Neural Filter: build a skin mask,
// then run an edge-preserving blur through it so texture softens while eyes,
// lips and hair keep detail. Composed entirely from existing engine ops:
//   • skin mask   = Color Range over the "Skin Tones" sample set (chroma gate),
//                   intersected with the 68-point face-landmark hull when the
//                   face model is installed (eyes + lips subtracted),
//   • smoothing   = Smart Blur (bilateral, selection-aware, graded coverage).
// Engine-free orchestration so it unit-tests in node against a recorder fake.
// ponytail: chroma gate + landmark hull, not face-parsing segmentation — swap
// in a BiSeNet-style skin-parsing model for true Photoshop-grade masks.
// ─────────────────────────────────────────────────────────────

/** Light→deep skin samples — the same graded set as the Color Range
 *  "Skin Tones" preset (ui/Dialogs.tsx); the fuzziness falloff fills between. */
export const SKIN_TONE_SAMPLES: readonly [number, number, number][] = [
  [244, 208, 177], [224, 172, 138], [198, 134, 94], [141, 85, 58], [92, 51, 35],
];

/** Color Range fuzziness for the skin gate — wide enough to bridge the graded
 *  samples, narrow enough to exclude hair/eyes/background. */
export const SKIN_FUZZINESS = 60;

/** Map the Adobe-style sliders (Blur / Smoothness, both 0..100) onto Smart
 *  Blur's engine args. radius < 1 means "no visible effect" — callers skip. */
export function skinSmoothingParams(blur: number, smoothness: number): { radius: number; threshold: number } {
  const b = Math.max(0, Math.min(100, blur));
  const s = Math.max(0, Math.min(100, smoothness));
  return {
    radius: Math.round(b / 8),          // 0..12 px bilateral window
    threshold: 16 + s,                  // 16..116 of 255 — tonal tolerance
  };
}

type Pt = readonly [number, number];

/** Scale a polygon about its centroid (pad eye/lip cutouts past the lash line). */
export function scalePolygon(pts: Pt[], factor: number): { xs: Float32Array; ys: Float32Array } {
  let cx = 0, cy = 0;
  for (const [x, y] of pts) { cx += x; cy += y; }
  cx /= pts.length; cy /= pts.length;
  const xs = new Float32Array(pts.length), ys = new Float32Array(pts.length);
  pts.forEach(([x, y], i) => { xs[i] = cx + (x - cx) * factor; ys[i] = cy + (y - cy) * factor; });
  return { xs, ys };
}

// iBUG 68-point layout: jaw 0-16, brows 17-26, eyes 36-41 / 42-47, outer lips 48-59.
const FOREHEAD_RISE = 0.4; // brow points raised by 40% of brow→chin height — the 68-pt hull has no forehead

/** Face outline: jaw left→right, then brows right→left raised to cover the
 *  forehead. The chroma-gate intersection trims any hair the hull overshoots. */
export function faceHullPolygon(face: Pt[]): { xs: Float32Array; ys: Float32Array } {
  const chinY = face[8][1];
  const hull: Pt[] = [
    ...face.slice(0, 17),
    ...face.slice(17, 27).reverse().map(([x, y]): Pt => [x, y - (chinY - y) * FOREHEAD_RISE]),
  ];
  const xs = new Float32Array(hull.length), ys = new Float32Array(hull.length);
  hull.forEach(([x, y], i) => { xs[i] = x; ys[i] = y; });
  return { xs, ys };
}

/** Detail regions to KEEP sharp: both eyes (padded past the lashes) + lips. */
export function detailCutouts(face: Pt[]): { xs: Float32Array; ys: Float32Array }[] {
  return [
    scalePolygon(face.slice(36, 42), 1.5),
    scalePolygon(face.slice(42, 48), 1.5),
    scalePolygon(face.slice(48, 60), 1.15),
  ];
}

/** The engine surface Skin Smoothing drives — matches the wasm Engine methods. */
export interface SkinSmoothEngine {
  has_selection(): boolean;
  get_selection_mask(): Uint8Array;
  set_selection_mask(mask: Uint8Array): void;
  select_none(): void;
  select_polygon(xs: Float32Array, ys: Float32Array, mode: number): void;
  select_color_range_batch(samples: Uint8Array, subtract: Uint8Array, fuzziness: number, mode: number, invert: boolean, allLayers: boolean): void;
  smart_blur(radius: number, threshold: number, mode: number, quality: number): void;
}

// SelMode wire values (engine SelMode::from_u8).
const SEL_REPLACE = 0, SEL_ADD = 1, SEL_SUBTRACT = 2, SEL_INTERSECT = 3;
const NO_SUBTRACT = new Uint8Array(0);
const FLAT_SAMPLES = Uint8Array.from(SKIN_TONE_SAMPLES.flat());

/**
 * One-click Skin Smoothing. `faces` is the 68-point landmark set per detected
 * face (document pixels) or null when the face model isn't installed — then
 * the chroma gate alone selects the skin. The user's selection is preserved.
 * Returns false when Blur rounds to a no-op radius (nothing touched).
 */
export function applySkinSmoothing(e: SkinSmoothEngine, faces: Pt[][] | null, blur: number, smoothness: number): boolean {
  const { radius, threshold } = skinSmoothingParams(blur, smoothness);
  if (radius < 1) return false;
  const prev = e.has_selection() ? e.get_selection_mask() : null;
  if (faces?.length) {
    faces.forEach((face, i) => {
      const hull = faceHullPolygon(face);
      e.select_polygon(hull.xs, hull.ys, i === 0 ? SEL_REPLACE : SEL_ADD);
    });
    // Chroma gate ∩ face hulls (mask from the composite), minus eyes + lips.
    e.select_color_range_batch(FLAT_SAMPLES, NO_SUBTRACT, SKIN_FUZZINESS, SEL_INTERSECT, false, true);
    for (const face of faces)
      for (const cut of detailCutouts(face)) e.select_polygon(cut.xs, cut.ys, SEL_SUBTRACT);
  } else {
    e.select_color_range_batch(FLAT_SAMPLES, NO_SUBTRACT, SKIN_FUZZINESS, SEL_REPLACE, false, true);
  }
  // Bilateral smoothing through the graded skin mask — edges inside skin
  // (nostrils, jawline) survive via the tonal threshold; mode 0 Normal, high quality.
  e.smart_blur(radius, threshold, 0, 2);
  if (prev) e.set_selection_mask(prev); else e.select_none();
  return true;
}
