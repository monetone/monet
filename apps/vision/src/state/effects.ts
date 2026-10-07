// ─────────────────────────────────────────────────────────────
// Layer-effect (Photoshop "Layer Style") param model — the TS mirror
// of engine/src/effects.rs. Each effect is a flat f32 array whose
// layout matches the Rust decoder exactly; `FX_DEFS` describes the
// fields so the Blending Options dialog can render generic controls.
// ─────────────────────────────────────────────────────────────

// Effect ids — must match effects.rs.
export const FX = {
  DROP_SHADOW: 0,
  INNER_SHADOW: 1,
  OUTER_GLOW: 2,
  INNER_GLOW: 3,
  BEVEL: 4,
  SATIN: 5,
  COLOR_OVERLAY: 6,
  GRADIENT_OVERLAY: 7,
  PATTERN_OVERLAY: 8,
  STROKE: 9,
} as const;

// A layer carries up to this many instances of each effect type (stacked
// strokes, layered shadows) — the engine's `FX_MAX_INSTANCES`. Instances are
// addressed by index through `set_layer_effect_at` / `layer_effect_params_at`;
// the single-argument ops still mean "the whole type".
export const FX_MAX_INSTANCES = 10;

// A control bound to one (or, for color, three) slot(s) of the params array.
export type FxField =
  | { k: "blend"; i: number; label: string }
  | { k: "opacity"; i: number; label: string } // 0..1, shown 0..100
  | { k: "color"; i: number; label: string } // i, i+1, i+2
  | { k: "angle"; i: number; label: string } // degrees 0..360
  | { k: "px"; i: number; label: string; min: number; max: number }
  | { k: "unit"; i: number; label: string; min?: number; max?: number } // 0..1 shown 0..100
  | { k: "num"; i: number; label: string; min: number; max: number; step?: number }
  | { k: "select"; i: number; label: string; options: string[] }
  // A contour slot: the six built-ins plus the document's custom curve library,
  // so its values are NOT plain option indices (see state/contours.ts).
  | { k: "contour"; i: number; label: string }
  // A pattern slot: the procedural kinds plus the Patterns library, whose picks
  // are tile IDS, not option indices (see PATTERN_LIBRARY_BASE).
  | { k: "pattern"; i: number; label: string }
  | { k: "toggle"; i: number; label: string };

export interface FxDef {
  id: number;
  name: string;
  fields: FxField[];
  def: number[]; // default params; index 0 is the enabled flag
}

// blend-mode indices (into BLEND_ORDER in engineContracts.ts)
const NORMAL = 0;
const MULTIPLY = 3;
const SCREEN = 7;

// Contour slots use the k:"contour" field kind; the built-in names and the
// custom-curve library both live in state/contours.ts.

// Pattern picks — must match effects.rs `pattern_height` / `pattern_color`. The
// first three are procedural; "Defined" samples the Edit ▸ Define Pattern tile
// (the same one the Pattern Stamp and pattern fill layers use), tiled from the
// canvas origin with the effect's Scale slot as a zoom — its stock 16 is 1:1.
export const PATTERNS = ["Checker", "Grid", "Dots", "Defined"];

/** Pattern kinds at or above this name a tile from the Patterns library by id,
 *  so an effect carries its own pattern instead of sharing the one global slot
 *  (#420). Mirrors effects.rs `Tiles::LIBRARY_BASE`. */
export const PATTERN_LIBRARY_BASE = 100;

/** The id a named library pattern is known by, in effect params and in the
 *  engine's pattern library. Derived from the NAME, not the position: the
 *  library reorders and rows are deleted, and a style that stored a position
 *  would silently start rendering its neighbour's tile. FNV-1a, folded to 24
 *  bits so the id stays exactly representable as the f32 an effect slot holds. */
export function patternLibraryId(name: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return PATTERN_LIBRARY_BASE + (h % 0xffffff);
}

/** Whether a pattern slot names a library tile rather than a procedural kind. */
export function isLibraryPattern(kind: number): boolean {
  return kind >= PATTERN_LIBRARY_BASE;
}

// Gradient Overlay styles — the same codes as the Gradient tool's `kind`
// (engine `gradient_fill`), so 0 Linear / 1 Radial keep their old meaning.
const GRADIENT_STYLES = ["Linear", "Radial", "Angle", "Reflected", "Diamond"];

// Glow Technique + Fill Type — must match effects.rs `outer_glow` / `finish_glow`.
const GLOW_TECHNIQUE = ["Softer", "Precise"];
const GLOW_FILL = ["Color", "Gradient"];

// Outer/Inner Glow share a five-slot tail starting at their Technique slot;
// `finish_glow` in effects.rs decodes it relative to that same base.
const glowTail = (base: number): FxField[] => [
  { k: "select", i: base, label: "Technique", options: GLOW_TECHNIQUE },
  { k: "unit", i: base + 1, label: "Noise" },
  { k: "unit", i: base + 2, label: "Range" },
  { k: "unit", i: base + 3, label: "Jitter" },
  { k: "select", i: base + 4, label: "Fill Type", options: GLOW_FILL },
  { k: "color", i: base + 5, label: "Gradient End" },
];

// …and its defaults: Softer, no noise, full range (identity — Photoshop's 50%
// would silently restyle every existing glow), no jitter, Color fill, and an
// end colour that makes switching to Gradient visibly do something.
const GLOW_TAIL_DEF = [0, 0, 1, 0, 0, 1, 0.4, 0];

export const FX_DEFS: FxDef[] = [
  {
    id: FX.DROP_SHADOW,
    name: "Drop Shadow",
    // 11 (knockout) defaults ON, which is also how effects.rs reads a vector
    // that predates the slot — the shadow has always been knocked out.
    def: [1, MULTIPLY, 0.75, 0, 0, 0, 120, 10, 0, 10, 0, 1, 0],
    fields: [
      { k: "blend", i: 1, label: "Blend Mode" },
      { k: "opacity", i: 2, label: "Opacity" },
      { k: "color", i: 3, label: "Color" },
      { k: "angle", i: 6, label: "Angle" },
      { k: "px", i: 7, label: "Distance", min: 0, max: 100 },
      { k: "unit", i: 8, label: "Spread" },
      { k: "px", i: 9, label: "Size", min: 0, max: 100 },
      { k: "contour", i: 10, label: "Contour" },
      { k: "toggle", i: 11, label: "Layer Knocks Out" },
      { k: "unit", i: 12, label: "Noise" },
    ],
  },
  {
    id: FX.INNER_SHADOW,
    name: "Inner Shadow",
    def: [1, MULTIPLY, 0.75, 0, 0, 0, 120, 8, 0, 8, 0, 0],
    fields: [
      { k: "blend", i: 1, label: "Blend Mode" },
      { k: "opacity", i: 2, label: "Opacity" },
      { k: "color", i: 3, label: "Color" },
      { k: "angle", i: 6, label: "Angle" },
      { k: "px", i: 7, label: "Distance", min: 0, max: 100 },
      { k: "unit", i: 8, label: "Choke" },
      { k: "px", i: 9, label: "Size", min: 0, max: 100 },
      { k: "contour", i: 10, label: "Contour" },
      { k: "unit", i: 11, label: "Noise" },
    ],
  },
  {
    id: FX.OUTER_GLOW,
    name: "Outer Glow",
    def: [1, SCREEN, 0.75, 1, 1, 0.6, 0, 14, 0, ...GLOW_TAIL_DEF],
    fields: [
      { k: "blend", i: 1, label: "Blend Mode" },
      { k: "opacity", i: 2, label: "Opacity" },
      { k: "color", i: 3, label: "Color" },
      { k: "unit", i: 6, label: "Spread" },
      { k: "px", i: 7, label: "Size", min: 0, max: 150 },
      { k: "contour", i: 8, label: "Contour" },
      ...glowTail(9),
    ],
  },
  {
    id: FX.INNER_GLOW,
    name: "Inner Glow",
    def: [1, SCREEN, 0.75, 1, 1, 0.6, 0, 12, 0, 0, ...GLOW_TAIL_DEF],
    fields: [
      { k: "blend", i: 1, label: "Blend Mode" },
      { k: "opacity", i: 2, label: "Opacity" },
      { k: "color", i: 3, label: "Color" },
      { k: "unit", i: 6, label: "Choke" },
      { k: "px", i: 7, label: "Size", min: 0, max: 150 },
      { k: "select", i: 8, label: "Source", options: ["Edge", "Center"] },
      { k: "contour", i: 9, label: "Contour" },
      ...glowTail(10),
    ],
  },
  {
    id: FX.BEVEL,
    name: "Bevel & Emboss",
    // 17.. are appended: an older 17-float vector decodes to Smooth / Up /
    // Linear gloss with both sub-effects off, i.e. exactly today's render.
    def: [
      1, SCREEN, 0.75, 1, 1, 1, MULTIPLY, 0.75, 0, 0, 0, 120, 30, 1, 8, 0, 0,
      0, 0, 0, // technique, direction, gloss contour
      0, 0, 0.5, // contour sub-effect: on, curve, range
      0, 0, 16, 1, 0, // texture sub-effect: on, pattern, scale, depth, invert
    ],
    fields: [
      { k: "blend", i: 1, label: "Highlight Mode" },
      { k: "opacity", i: 2, label: "Highlight Opacity" },
      { k: "color", i: 3, label: "Highlight" },
      { k: "blend", i: 6, label: "Shadow Mode" },
      { k: "opacity", i: 7, label: "Shadow Opacity" },
      { k: "color", i: 8, label: "Shadow" },
      { k: "angle", i: 11, label: "Angle" },
      { k: "num", i: 12, label: "Altitude", min: 0, max: 90 },
      { k: "num", i: 13, label: "Depth", min: 0.1, max: 8, step: 0.1 },
      { k: "px", i: 14, label: "Size", min: 1, max: 100 },
      { k: "px", i: 15, label: "Soften", min: 0, max: 40 },
      { k: "select", i: 16, label: "Style", options: ["Inner Bevel", "Outer Bevel", "Emboss", "Pillow", "Stroke Emboss"] },
      { k: "select", i: 17, label: "Technique", options: ["Smooth", "Chisel Hard", "Chisel Soft"] },
      { k: "select", i: 18, label: "Direction", options: ["Up", "Down"] },
      { k: "contour", i: 19, label: "Gloss Contour" },
      { k: "toggle", i: 20, label: "Contour" },
      { k: "contour", i: 21, label: "Contour Curve" },
      { k: "unit", i: 22, label: "Contour Range" },
      { k: "toggle", i: 23, label: "Texture" },
      { k: "pattern", i: 24, label: "Texture Pattern" },
      { k: "num", i: 25, label: "Texture Scale", min: 2, max: 128, step: 1 },
      { k: "num", i: 26, label: "Texture Depth", min: -2, max: 2, step: 0.05 },
      { k: "toggle", i: 27, label: "Texture Invert" },
    ],
  },
  {
    id: FX.SATIN,
    name: "Satin",
    def: [1, MULTIPLY, 0.5, 0.4, 0.2, 0.5, 19, 11, 14, 1, 0],
    fields: [
      { k: "blend", i: 1, label: "Blend Mode" },
      { k: "opacity", i: 2, label: "Opacity" },
      { k: "color", i: 3, label: "Color" },
      { k: "angle", i: 6, label: "Angle" },
      { k: "px", i: 7, label: "Distance", min: 0, max: 100 },
      { k: "px", i: 8, label: "Size", min: 0, max: 100 },
      { k: "toggle", i: 9, label: "Invert" },
      { k: "contour", i: 10, label: "Contour" },
    ],
  },
  {
    id: FX.COLOR_OVERLAY,
    name: "Color Overlay",
    def: [1, NORMAL, 1, 1, 0, 0],
    fields: [
      { k: "blend", i: 1, label: "Blend Mode" },
      { k: "opacity", i: 2, label: "Opacity" },
      { k: "color", i: 3, label: "Color" },
    ],
  },
  {
    id: FX.GRADIENT_OVERLAY,
    name: "Gradient Overlay",
    // 13.. are appended: an older 13-float vector decodes to no dither, aligned
    // to the layer, no offset and no stop tail — i.e. exactly today's render.
    def: [1, NORMAL, 1, 90, 1, 0, 0, 0.1, 0.2, 0.6, 0.9, 0.4, 0.1, 0, 1, 0, 0, 0],
    fields: [
      { k: "blend", i: 1, label: "Blend Mode" },
      { k: "opacity", i: 2, label: "Opacity" },
      // `num`, not `angle`: Layer ▸ Global Light drives the first angle field of
      // every effect, and Photoshop's Gradient Overlay has no Use Global Light.
      // It also frees slot `def.length` (the dialog's global-light flag) for the
      // multi-stop tail.
      { k: "num", i: 3, label: "Angle", min: 0, max: 360 },
      { k: "num", i: 4, label: "Scale", min: 0.1, max: 4, step: 0.05 },
      { k: "select", i: 5, label: "Style", options: GRADIENT_STYLES },
      { k: "toggle", i: 6, label: "Reverse" },
      { k: "toggle", i: 13, label: "Dither" },
      { k: "toggle", i: 14, label: "Align with Layer" },
      { k: "num", i: 15, label: "Offset X", min: -1, max: 1, step: 0.05 },
      { k: "num", i: 16, label: "Offset Y", min: -1, max: 1, step: 0.05 },
      // The ends of the ramp — they stay live on a multi-stop gradient too
      // (effects.rs `overlay_stops` folds them onto the first/last stop).
      { k: "color", i: 7, label: "Start" },
      { k: "color", i: 10, label: "End" },
    ],
  },
  {
    id: FX.PATTERN_OVERLAY,
    name: "Pattern Overlay",
    def: [1, NORMAL, 1, 16, 0],
    fields: [
      { k: "blend", i: 1, label: "Blend Mode" },
      { k: "opacity", i: 2, label: "Opacity" },
      { k: "num", i: 3, label: "Scale", min: 2, max: 128, step: 1 },
      { k: "pattern", i: 4, label: "Pattern" },
    ],
  },
  {
    id: FX.STROKE,
    name: "Stroke",
    def: [1, NORMAL, 1, 1, 0.1, 0.1, 3, 1, 0, 90, 1, 0.85, 0.1, 0, 16],
    fields: [
      { k: "blend", i: 1, label: "Blend Mode" },
      { k: "opacity", i: 2, label: "Opacity" },
      { k: "color", i: 3, label: "Color" },
      { k: "px", i: 6, label: "Size", min: 1, max: 100 },
      { k: "select", i: 7, label: "Position", options: ["Outside", "Inside", "Center"] },
      // Fill Type 1/2 reuse Color (slot 3) as the gradient's start stop.
      { k: "select", i: 8, label: "Fill Type", options: ["Color", "Gradient", "Pattern"] },
      // `num`, not `angle`: Layer ▸ Global Light drives the first angle field of
      // every effect, and a gradient's rotation is not the light direction.
      { k: "num", i: 9, label: "Gradient Angle", min: 0, max: 360 },
      { k: "color", i: 10, label: "Gradient End" },
      { k: "pattern", i: 13, label: "Pattern" },
      { k: "num", i: 14, label: "Pattern Scale", min: 2, max: 128, step: 1 },
    ],
  },
];

export const fxDef = (id: number): FxDef => FX_DEFS.find((d) => d.id === id)!;

// ── Gradient Overlay's multi-stop tail ─────────────────────────
// The generic FxField controls can only reach scalars, so an arbitrary ramp
// rides past the field slots: slot 17 holds the stop count, then that many
// [pos, r, g, b, a] runs (all 0..1) from slot 18 — the same packing as
// `add_gradient_fill_layer` and the Gradient tool. Fewer than 2 stops means
// "no ramp authored", and effects.rs falls back to the Start/End colours.
export const FX_GRAD_COUNT = 17;
export const FX_GRAD_STOPS = 18;

/** One Gradient Overlay ramp stop, in the engine's 0..1 units. */
export interface FxGradientStop { pos: number; r: number; g: number; b: number; a: number }

/** The overlay's ramp: its stop tail, or the two Start/End colours when no tail
 *  has been authored. Always ≥ 2 stops, ascending. */
export function fxGradientStops(params: number[]): FxGradientStop[] {
  // Floor the count (#141): externally-authored params can carry a fractional
  // slot 17, and `Array.from({length: n})` truncates it via ToLength — so
  // `out[n - 1]` would be a hole and `Object.assign` would throw. The engine's
  // `overlay_stops` truncates the same way (`as usize`).
  const n = Math.floor(params[FX_GRAD_COUNT] ?? 0);
  const at = (i: number) => params[i] ?? 0;
  if (!(n >= 2) || params.length < FX_GRAD_STOPS + n * 5) {
    return [
      { pos: 0, r: at(7), g: at(8), b: at(9), a: 1 },
      { pos: 1, r: at(10), g: at(11), b: at(12), a: 1 },
    ];
  }
  const out = Array.from({ length: n }, (_, k) => {
    const b = FX_GRAD_STOPS + k * 5;
    return { pos: at(b), r: at(b + 1), g: at(b + 2), b: at(b + 3), a: at(b + 4) };
  });
  // Slots 7..12 win over the tail's ends — see effects.rs `overlay_stops`.
  Object.assign(out[0], { r: at(7), g: at(8), b: at(9) });
  Object.assign(out[n - 1], { r: at(10), g: at(11), b: at(12) });
  return out;
}

/** `params` with `stops` written into the tail (sorted, clamped). The end
 *  colours are mirrored into slots 7..12 so the dialog's Start/End rows keep
 *  showing — and keep driving — the ramp's ends, which is how effects.rs reads
 *  them. Fewer than 2 stops clears the tail back to the two-colour ramp. */
export function withFxGradientStops(params: number[], stops: FxGradientStop[]): number[] {
  const base = params.slice(0, FX_GRAD_COUNT);
  while (base.length < FX_GRAD_COUNT) base.push(fxDef(FX.GRADIENT_OVERLAY).def[base.length]);
  const gs = [...stops].sort((a, b) => a.pos - b.pos);
  if (gs.length < 2) return [...base, 0];
  const u = (v: number) => Math.min(1, Math.max(0, v));
  const out = [...base, gs.length];
  for (const s of gs) out.push(u(s.pos), u(s.r), u(s.g), u(s.b), u(s.a));
  const last = gs[gs.length - 1];
  out[7] = u(gs[0].r); out[8] = u(gs[0].g); out[9] = u(gs[0].b);
  out[10] = u(last.r); out[11] = u(last.g); out[12] = u(last.b);
  return out;
}

// ── Blend-If ───────────────────────────────────────────────────
// 4 channels (gray, red, green, blue) × 8 values:
//   thisBlack0, thisBlack1, thisWhite0, thisWhite1,
//   underBlack0, underBlack1, underWhite0, underWhite1   (all 0..1)
export const BLEND_IF_CHANNELS = ["Gray", "Red", "Green", "Blue"] as const;

export function defaultBlendIf(): number[] {
  const ch = [0, 0, 1, 1, 0, 0, 1, 1];
  return [...ch, ...ch, ...ch, ...ch];
}

export function blendIfIsDefault(v: number[]): boolean {
  if (v.length !== 32) return v.length === 0;
  const d = defaultBlendIf();
  return v.every((x, i) => Math.abs(x - d[i]) < 1e-4);
}
