// Layer Style contours. Photoshop's contour slots offer built-in shapes AND a
// named library of custom curves authored in the Contour Editor; a slot stores
// one index either way. Pure (no engine import), so it unit-tests in node — the
// engine half is effects.rs::contour_map, which reads the same encoding.

/** The six built-in shapes, in slot order — must match effects.rs contour_map. */
export const BUILTIN_CONTOURS = [
  "Linear", "Cone", "Cone - Inverted", "Ring", "Gaussian", "Half Round",
] as const;

/** Custom curves start here, so a slot index says which kind it is on sight.
 *  Engine side: `contour_map` treats >= 100 as `contours[index - 100]`. */
export const CUSTOM_CONTOUR_BASE = 100;

/** How many samples a curve is flattened to before it reaches the engine.
 *  ponytail: fixed 64 — plenty for a coverage ramp; make it a per-curve length
 *  if anyone ever needs a contour with fine detail. */
export const CONTOUR_SAMPLES = 64;

export interface ContourPoint { x: number; y: number }

export interface CustomContour {
  name: string;
  /** Control points in 0..1, ascending in x. The engine gets them sampled. */
  points: ContourPoint[];
}

/** A slot value → whether it names a custom curve, and which. */
export function customContourIndex(slot: number): number | null {
  return slot >= CUSTOM_CONTOUR_BASE ? slot - CUSTOM_CONTOUR_BASE : null;
}

/** The slot value that selects custom curve `index`. */
export function customContourSlot(index: number): number {
  return CUSTOM_CONTOUR_BASE + index;
}

/** Every option a contour picker offers: the built-ins, then the library. */
export function contourOptions(library: readonly CustomContour[]): string[] {
  return [...BUILTIN_CONTOURS, ...library.map((c) => c.name)];
}

/** The label for a slot value, falling back to Linear when a custom curve has
 *  been deleted out from under a style that still references it. */
export function contourLabel(slot: number, library: readonly CustomContour[]): string {
  const custom = customContourIndex(slot);
  if (custom === null) return BUILTIN_CONTOURS[slot] ?? BUILTIN_CONTOURS[0];
  return library[custom]?.name ?? BUILTIN_CONTOURS[0];
}

/** Evaluate a curve at `t` (0..1) by linear interpolation between its points,
 *  which is what the engine's LUT does between samples. */
export function evalContour(points: readonly ContourPoint[], t: number): number {
  if (points.length < 2) return t;
  const x = Math.max(0, Math.min(1, t));
  const sorted = [...points].sort((a, b) => a.x - b.x);
  if (x <= sorted[0].x) return clamp01(sorted[0].y);
  const last = sorted[sorted.length - 1];
  if (x >= last.x) return clamp01(last.y);
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1];
    const b = sorted[i];
    if (x <= b.x) {
      const span = b.x - a.x;
      const f = span <= 0 ? 0 : (x - a.x) / span;
      return clamp01(a.y + (b.y - a.y) * f);
    }
  }
  return clamp01(last.y);
}

/** Flatten the library into the (flat samples, per-curve lengths) pair the
 *  engine's `set_contours` takes — wasm-bindgen cannot pass a nested array. */
export function flattenContours(library: readonly CustomContour[]): {
  flat: Float32Array;
  lengths: Uint32Array;
} {
  const flat = new Float32Array(library.length * CONTOUR_SAMPLES);
  const lengths = new Uint32Array(library.length);
  library.forEach((curve, c) => {
    lengths[c] = CONTOUR_SAMPLES;
    for (let i = 0; i < CONTOUR_SAMPLES; i++) {
      flat[c * CONTOUR_SAMPLES + i] = evalContour(curve.points, i / (CONTOUR_SAMPLES - 1));
    }
  });
  return { flat, lengths };
}

/** A fresh curve, straight through — Photoshop's New contour starts Linear. */
export function newContour(name: string): CustomContour {
  return { name, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] };
}

/** Coerce a stored library back to something safe: names present, at least two
 *  in-range points per curve. Stored in the document, so it can be stale. */
export function normalizeContours(raw: unknown): CustomContour[] {
  if (!Array.isArray(raw)) return [];
  const out: CustomContour[] = [];
  for (const entry of raw) {
    const e = entry as { name?: unknown; points?: unknown };
    if (typeof e?.name !== "string" || !Array.isArray(e.points)) continue;
    const points = e.points
      .map((p) => p as { x?: unknown; y?: unknown })
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
      .map((p) => ({ x: clamp01(p.x as number), y: clamp01(p.y as number) }));
    if (points.length >= 2) out.push({ name: e.name, points });
  }
  return out;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
