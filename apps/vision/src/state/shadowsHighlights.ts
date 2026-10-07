// ─────────────────────────────────────────────────────────────
// Shadows/Highlights (Image ▸ Adjustments ▸ Shadows/Highlights) — lift detail out of
// the shadows and pull detail back from the highlights, each over an adjustable tonal
// width. This is the engine's fast *global* tonal version (luminance-driven, no local
// blurred mask), so it is engine-free and unit-tests in node.
//
// MUST match `adjust.rs shadows_highlights`. Per pixel, with widths clamped to
// [0.01, 1] and midtone clamped to [−0.5, 0.5]:
//   l       = 0.299r + 0.587g + 0.114b                 (Rec.601 luminance)
//   sh_inf  = clamp01(1 − l / sw)                       (1 at black → 0 at l = sw)
//   hi_inf  = clamp01(1 − (1 − l) / hw)                 (1 at white → 0 at l = 1 − hw)
//   delta   = sh_amount·sh_inf·(1 − l) − hi_amount·hi_inf·l
//   n_c     = clamp01(c + delta)   for c ∈ {r, g, b}    (same delta → colour preserved)
//   if mt ≠ 0:  n_c = clamp01(n_c + mt·t·(0.25 − t²)·4),  t = n_c − 0.5   (midtone S-curve)
//   if color ≠ 0:  infl = clamp01(sh_inf + hi_inf),  satmul = 1 + color·infl,
//                  nl = Rec.601(n),  n_c = clamp01(nl + (n_c − nl)·satmul)   (chroma scale)
// Shadow lift fades to 0 as luminance approaches `sw`; highlight recovery fades to 0
// as luminance drops below `1 − hw`; midtones outside both bands are untouched by the
// delta (the S-curve, being global, still reaches them).
//
// The dialog drives `adj.shadowsHighlights(sa/100, sw/100, ha/100, hw/100, color/100,
// midtone/200)` — six sliders: four 0..100 ÷ 100, Color −100..100 ÷ 100 and Midtone
// −100..100 ÷ 200 (→ the engine's ±0.5 curve range). NOTE the dialog seeds Color at
// 20 (#135), so a *default dialog open* is NOT the identity — only all-zero sliders
// are. Amounts are used as-is (0..1 fractions); only the *widths* are clamped (engine
// `sh_width.clamp(0.01, 1.0)`), so a 0 width still leaves a 1%-tall band rather than
// dividing by zero.
//
// Show More Options (#442) adds a per-band Radius and Black/White Clip on top. Those are
// neighbourhood ops (a blurred mask, a histogram over the whole plane), so they live in the
// engine only; this mirror is the radius-0 / clip-0 case — which is exactly what
// `adj.shadowsHighlights`'s defaults send, so the six-arg call it models is unchanged.
//
// Runs in f64; the engine pipeline is f32. The output is continuous (clamped only at
// write-out), so f64↔f32 differences are absorbed by the round-half-up `byte()`
// quantization (≤1 LSB). Mirrors the `brightnessContrast.ts` / `exposure.ts` style.
// ─────────────────────────────────────────────────────────────

export interface ShadowsHighlightsState {
  /** Shadows amount (0..100); how strongly to lift the darkest tones. */
  shadowsAmount: number;
  /** Shadows tonal width (0..100); how far up from black the lift reaches. */
  shadowsWidth: number;
  /** Highlights amount (0..100); how strongly to recover the brightest tones. */
  highlightsAmount: number;
  /** Highlights tonal width (0..100); how far down from white the recovery reaches. */
  highlightsWidth: number;
  /** Color (−100..100); saturation of the corrected regions. Omitted → 0 (no chroma
   *  scale) — the dialog itself opens at 20, see the header note (#135). */
  color?: number;
  /** Midtone contrast (−100..100); S-curve strength, ÷200 into the engine's ±0.5. */
  midtone?: number;
}

export const AMOUNT_MIN = 0;
export const AMOUNT_MAX = 100;
// The dialog's Tonal Width sliders floor at 1 (= 0.01 fraction = the engine clamp floor),
// so the `width = 0 → 0.01` widening in `clampWidth` is defensive-only (not UI-reachable).
export const WIDTH_MIN = 1;
export const WIDTH_MAX = 100;
/** The engine clamps each tonal width (as a 0..1 fraction) to this range. */
export const WIDTH_CLAMP_MIN = 0.01;
export const WIDTH_CLAMP_MAX = 1;
/** The engine clamps midtone to ±0.5 — the curve's slope hits 0 at the endpoints there,
 *  so anything beyond would stop being monotone. */
export const MIDTONE_CLAMP = 0.5;

const clamp01 = (n: number): number => (n <= 0 ? 0 : n >= 1 ? 1 : n);
// Round-half-up to 8-bit (Photoshop's `to8`). The engine stores results at u16 (`to16`)
// and its display readback truncates (`u16_to_8` = `v >> 8`), so this round-half-up
// reference can differ from the engine's shown 8-bit output by ≤1 LSB.
const byte = (n: number): number => Math.round(clamp01(n) * 255);

/** Rec.601 luminance of normalised 0..1 channels (the engine's weighting). */
export function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** A fresh, no-op Shadows/Highlights state (all sliders at 0 → identity). */
export function defaultShadowsHighlights(): ShadowsHighlightsState {
  return { shadowsAmount: 0, shadowsWidth: 0, highlightsAmount: 0, highlightsWidth: 0, color: 0, midtone: 0 };
}

/** The direct-call args `[sh_amount, sh_width, hi_amount, hi_width, color, midtone]`
 *  as engine fractions, exactly as the dialog passes them: the four tone sliders and
 *  Color ÷ 100, Midtone ÷ 200 (#135 — the engine takes all six). */
export function shadowsHighlightsArgs(
  state: ShadowsHighlightsState,
): [number, number, number, number, number, number] {
  return [
    state.shadowsAmount / 100,
    state.shadowsWidth / 100,
    state.highlightsAmount / 100,
    state.highlightsWidth / 100,
    (state.color ?? 0) / 100,
    (state.midtone ?? 0) / 200,
  ];
}

/** Clamp a tonal width (0..1 fraction) to the engine's `[0.01, 1]` range. */
export function clampWidth(width: number): number {
  return width < WIDTH_CLAMP_MIN ? WIDTH_CLAMP_MIN : width > WIDTH_CLAMP_MAX ? WIDTH_CLAMP_MAX : width;
}

/** Shadow influence at luminance `l` for a shadow width (0..1): `clamp01(1 − l/sw)`.
 *  1 at black, ramping linearly to 0 at `l = clampWidth(width)`. */
export function shadowInfluence(l: number, width: number): number {
  return clamp01(1 - l / clampWidth(width));
}

/** Highlight influence at luminance `l` for a highlight width (0..1):
 *  `clamp01(1 − (1−l)/hw)`. 1 at white, ramping to 0 at `l = 1 − clampWidth(width)`. */
export function highlightInfluence(l: number, width: number): number {
  return clamp01(1 - (1 - l) / clampWidth(width));
}

/** The luminance-driven delta added to every channel:
 *  `sh_amount·sh_inf·(1−l) − hi_amount·hi_inf·l`. Inputs are 0..1 fractions. */
export function toneDelta(
  l: number,
  shAmount: number,
  shWidth: number,
  hiAmount: number,
  hiWidth: number,
): number {
  const shInf = shadowInfluence(l, shWidth);
  const hiInf = highlightInfluence(l, hiWidth);
  return shAmount * shInf * (1 - l) - hiAmount * hiInf * l;
}

/** Clamp a midtone fraction to the engine's `[−0.5, 0.5]` range. */
export function clampMidtone(midtone: number): number {
  return midtone < -MIDTONE_CLAMP ? -MIDTONE_CLAMP : midtone > MIDTONE_CLAMP ? MIDTONE_CLAMP : midtone;
}

/** The midtone-contrast S-curve, fixed at 0 / 0.5 / 1: `v + mt·t·(0.25 − t²)·4` with
 *  `t = v − 0.5`. `mt > 0` steepens the midtones, `mt < 0` flattens them; black and
 *  white are untouched. `mt` is clamped to ±0.5 (engine `midtone.clamp`). */
export function midtoneCurve(v: number, midtone: number): number {
  const mt = clampMidtone(midtone);
  if (mt === 0) return v;
  const t = v - 0.5;
  return clamp01(v + mt * t * (0.25 - t * t) * 4);
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** The Color slider's chroma scale: push each channel away from (or toward) the
 *  pixel's own luma by `1 + color·infl`, where `infl = clamp01(sh_inf + hi_inf)` —
 *  so only pixels the correction actually touched get resaturated. */
export function colorScale(rgb: Rgb, color: number, influence: number): Rgb {
  if (color === 0) return rgb;
  const satmul = 1 + color * clamp01(influence);
  const nl = luminance(rgb.r, rgb.g, rgb.b);
  const f = (c: number): number => clamp01(nl + (c - nl) * satmul);
  return { r: f(rgb.r), g: f(rgb.g), b: f(rgb.b) };
}

/** Apply Shadows/Highlights to an 8-bit pixel the way the engine does: the luminance
 *  delta on all three channels (colour preserved), then the midtone S-curve, then the
 *  Color chroma scale — clamping after each stage, exactly as `adjust.rs` does (#135).
 *  Runs in f64 (engine is f32) so it matches to 8-bit precision. For tests / previews. */
export function applyShadowsHighlights(
  state: ShadowsHighlightsState,
  r: number,
  g: number,
  b: number,
): Rgb {
  const [sa, sw, ha, hw, color, midtone] = shadowsHighlightsArgs(state);
  const [r01, g01, b01] = [r / 255, g / 255, b / 255];
  const l = luminance(r01, g01, b01);
  const delta = toneDelta(l, sa, sw, ha, hw);
  let out: Rgb = { r: clamp01(r01 + delta), g: clamp01(g01 + delta), b: clamp01(b01 + delta) };
  const mt = clampMidtone(midtone);
  if (mt !== 0) out = { r: midtoneCurve(out.r, mt), g: midtoneCurve(out.g, mt), b: midtoneCurve(out.b, mt) };
  out = colorScale(out, color, shadowInfluence(l, sw) + highlightInfluence(l, hw));
  return { r: byte(out.r), g: byte(out.g), b: byte(out.b) };
}
