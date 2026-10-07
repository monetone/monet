// ─────────────────────────────────────────────────────────────
// Gradient Map (Image ▸ Adjustments ▸ Gradient Map) — pure LUT building.
//
// Remaps each pixel's luminance through a multi-stop colour gradient: shadows take
// the left-most stop, highlights the right-most. Engine-free so it unit-tests in
// node; two consumers, two LUT layouts, one sampler:
//   • the direct adjustment → engine `adjust_gradient_map` wants a Uint8 RGBA LUT
//     (256×4, alpha ignored);
//   • the kind-13 adjustment layer wants a normalised f32 RGB LUT (256×3).
// Both index the LUT by Rec.601 luminance, so the weights here MUST match the
// engine (`adjust.rs gradient_map` / `pixel_adjust.rs` kind 13). All gradient
// logic (multi-stop, midpoints, reverse) is baked into the LUT on this side, which
// is why it is fully testable without WASM. Mirrors `toneCurve.ts buildLut`.
// ─────────────────────────────────────────────────────────────

// A gradient colour stop: position 0..1 along the ramp with 8-bit RGB(A). Structural
// (no monet-ui / store import) so it stays node-safe, like toneCurve's CurvePointLike.
// `a` is optional and defaults to 255 — the engine ignores it for gradient map, but
// keeping it lets store `GradientStop` values flow straight in.
export type GradientMapStop = { pos: number; r: number; g: number; b: number; a?: number };

export interface GradientMapOptions {
  /** Photoshop's "Reverse" checkbox — flip the ramp end-for-end. */
  reverse?: boolean;
  /** Per-gap midpoint location 0..1 (the diamond between two adjacent stops);
   *  default 0.5 ⇒ linear. Indexed by gap, so length should be stops−1; missing or
   *  non-finite entries fall back to 0.5. */
  midpoints?: readonly number[];
}

// Rec.601 luminance weights — MUST match the engine so a TS-built LUT maps a pixel
// to the same gradient slot the engine reads it from.
export const LUMA_R = 0.299;
export const LUMA_G = 0.587;
export const LUMA_B = 0.114;

export interface Rgba { r: number; g: number; b: number; a: number; }

const clampByte = (n: number): number => (n <= 0 ? 0 : n >= 255 ? 255 : Math.round(n));
const clamp01 = (n: number): number => (n <= 0 ? 0 : n >= 1 ? 1 : n);

/** The LUT slot (0..255) the engine maps an 8-bit pixel to: its Rec.601 luminance,
 *  rounded — mirroring the engine's `(l*255+0.5)` on normalised channels (since
 *  `l*255 = 0.299r+0.587g+0.114b`). Computed on 8-bit channels here, so a result
 *  can in principle differ from the engine by 1 LSB exactly at a half-integer
 *  luminance; it is a prediction helper and never feeds the actual LUT. Use it to
 *  anticipate a gradient-map result: pixel → `lut[gradientMapIndex(r,g,b)]`. */
export function gradientMapIndex(r: number, g: number, b: number): number {
  return clampByte(LUMA_R * r + LUMA_G * g + LUMA_B * b);
}

// The Black → White ramp used when no stops are supplied (identity in luminance).
const DEFAULT_STOPS: readonly GradientMapStop[] = [
  { pos: 0, r: 0, g: 0, b: 0, a: 255 },
  { pos: 1, r: 255, g: 255, b: 255, a: 255 },
];

// Sorted ascending by position, with alpha defaulted — a fresh array we may mutate.
function sortStops(stops: readonly GradientMapStop[]): GradientMapStop[] {
  return stops.map((s) => ({ ...s, a: s.a ?? 255 })).sort((x, y) => x.pos - y.pos);
}

// Midpoint (diamond) warp: reshape a gap-local t∈[0,1] so the 50% colour blend
// lands at `m` instead of the centre. This is the piecewise-linear approximation
// (linear on each side of the midpoint), not Photoshop's exact power curve — close
// enough for a LUT and cheap. m≈0.5 ⇒ f===t (plain linear). Degenerate / non-finite
// m falls back to 0.5 so a bad midpoint can never divide by zero.
function warpMidpoint(t: number, m: number): number {
  const mid = m > 0 && m < 1 ? m : 0.5;
  if (mid === 0.5) return t;
  return t < mid ? 0.5 * (t / mid) : 0.5 + 0.5 * ((t - mid) / (1 - mid));
}

// Interpolate the ramp colour at `pos` over already-sorted stops; ends clamp to the
// first/last stop. Channels are rounded to 8-bit to match the engine's LUT precision
// (and the previous inline behaviour), so the RGBA and f32 builders stay byte-exact.
function sampleSorted(
  stops: GradientMapStop[],
  midpoints: readonly number[] | undefined,
  pos: number,
): Rgba {
  const n = stops.length;
  const first = stops[0];
  const last = stops[n - 1];
  if (pos <= first.pos) return { r: first.r, g: first.g, b: first.b, a: first.a ?? 255 };
  if (pos >= last.pos) return { r: last.r, g: last.g, b: last.b, a: last.a ?? 255 };
  for (let i = 0; i < n - 1; i++) {
    const lo = stops[i];
    const hi = stops[i + 1];
    if (pos >= lo.pos && pos <= hi.pos) {
      const span = hi.pos - lo.pos;
      // Coincident stops (span 0) ⇒ hard edge: take the left colour.
      const t = span > 0 ? warpMidpoint((pos - lo.pos) / span, midpoints?.[i] ?? 0.5) : 0;
      const la = lo.a ?? 255;
      const ha = hi.a ?? 255;
      return {
        r: clampByte(lo.r + (hi.r - lo.r) * t),
        g: clampByte(lo.g + (hi.g - lo.g) * t),
        b: clampByte(lo.b + (hi.b - lo.b) * t),
        a: clampByte(la + (ha - la) * t),
      };
    }
  }
  return { r: last.r, g: last.g, b: last.b, a: last.a ?? 255 };
}

// Resolve stops + midpoints to a fast forward sampler once (sort done a single
// time, not per LUT entry), so building a 256-entry LUT is O(256 × stops). Reverse
// is NOT handled here — callers apply it as `1 − pos`, which is the exact
// end-for-end mirror of this forward ramp (and keeps the reversed LUT a bit-exact
// index mirror of the forward one, midpoints included).
function prepare(
  stops: readonly GradientMapStop[],
  midpoints: readonly number[] | undefined,
): (pos: number) => Rgba {
  const sorted = stops.length ? sortStops(stops) : sortStops(DEFAULT_STOPS);
  if (sorted.length === 1) {
    const only = sorted[0];
    const c: Rgba = { r: only.r, g: only.g, b: only.b, a: only.a ?? 255 };
    return () => ({ ...c });
  }
  return (pos: number) => sampleSorted(sorted, midpoints, clamp01(pos));
}

/** The interpolated gradient colour at `pos` (0..1), honouring sort order,
 *  midpoints and reverse. Positions outside [0,1] clamp to the ends. */
export function sampleGradientMap(
  stops: readonly GradientMapStop[],
  pos: number,
  opts: GradientMapOptions = {},
): Rgba {
  const p = clamp01(pos);
  return prepare(stops, opts.midpoints)(opts.reverse ? 1 - p : p);
}

/** 256-entry RGBA LUT (stride 4, alpha 255) for engine `adjust_gradient_map`.
 *  `lut[i]` is the gradient colour at luminance i/255. */
export function buildGradientMapLutRgba(
  stops: readonly GradientMapStop[],
  opts: GradientMapOptions = {},
): Uint8Array {
  const at = prepare(stops, opts.midpoints);
  const out = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const c = at((opts.reverse ? 255 - i : i) / 255);
    const o = i * 4;
    out[o] = c.r;
    out[o + 1] = c.g;
    out[o + 2] = c.b;
    out[o + 3] = 255;
  }
  return out;
}

/** 256-entry normalised RGB LUT (stride 3, channels 0..1) for the kind-13
 *  adjustment layer. Byte-exact with {@link buildGradientMapLutRgba} ÷ 255. */
export function buildGradientMapLutF32(
  stops: readonly GradientMapStop[],
  opts: GradientMapOptions = {},
): Float32Array {
  const at = prepare(stops, opts.midpoints);
  const out = new Float32Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const c = at((opts.reverse ? 255 - i : i) / 255);
    const o = i * 3;
    out[o] = c.r / 255;
    out[o + 1] = c.g / 255;
    out[o + 2] = c.b / 255;
  }
  return out;
}

export interface GradientMapPreset {
  name: string;
  stops: GradientMapStop[];
}

// Built-in presets (the classic Black→White plus duotone-style ramps and one
// three-stop ramp to exercise multi-stop). Positions span 0..1 so the first/last
// stop define the shadow/highlight colours.
export const GRADIENT_MAP_PRESETS: readonly GradientMapPreset[] = [
  { name: "Black → White", stops: [{ pos: 0, r: 0, g: 0, b: 0 }, { pos: 1, r: 255, g: 255, b: 255 }] },
  { name: "Sepia", stops: [{ pos: 0, r: 30, g: 18, b: 4 }, { pos: 1, r: 255, g: 232, b: 186 }] },
  { name: "Blue → Orange", stops: [{ pos: 0, r: 12, g: 22, b: 80 }, { pos: 1, r: 255, g: 160, b: 40 }] },
  { name: "Violet → Yellow", stops: [{ pos: 0, r: 60, g: 0, b: 90 }, { pos: 1, r: 255, g: 240, b: 80 }] },
  {
    name: "Cobalt · Magenta · Gold",
    stops: [
      { pos: 0, r: 10, g: 20, b: 70 },
      { pos: 0.5, r: 200, g: 30, b: 120 },
      { pos: 1, r: 255, g: 215, b: 90 },
    ],
  },
];

export const DEFAULT_GRADIENT_MAP = GRADIENT_MAP_PRESETS[0];

/** Look up a preset by name, falling back to Black → White. */
export function gradientMapPreset(name: string): GradientMapPreset {
  return GRADIENT_MAP_PRESETS.find((p) => p.name === name) ?? GRADIENT_MAP_PRESETS[0];
}
