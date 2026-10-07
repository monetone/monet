// ─────────────────────────────────────────────────────────────
// Chalk & Charcoal (Filter ▸ Sketch ▸ Chalk & Charcoal) — redraws the image as a three-tone
// chalk-and-charcoal sketch: dark areas become the CHARCOAL (foreground) colour, light areas the
// CHALK (background) colour, and mid-tones a flat 50% grey, with a stroke-pressure control that
// blends the result back toward the original. Deterministic; engine-free so it unit-tests in node.
//
// The tone is chosen by LUMINANCE (Rec.601 over R,G,B) against two independent thresholds, and the
// blend is per channel toward that tone's colour. On a grey image (R=G=B=v) with grey fg/bg this
// matches `chalk_charcoal` bit-for-bit — modelled here as one channel (fg/bg as single u8 values,
// Photoshop's default foreground=black=0 / background=white=255).
//
// MUST match `filters.rs chalk_charcoal` (grey domain, full selection ⇒ cov 1):
//   lo = clamp(charcoal_area,0,1)         // L < lo → charcoal (fg)
//   hi = 1 − clamp(chalk_area,0,1)        // L > hi → chalk (bg)
//   keep = 1 − clamp(stroke_pressure,0,1) // 0 ⇒ pure tone; 1 ⇒ original
//   L = (v·0.299 + v·0.587 + v·0.114) / 65535         (grey: the three channels coincide)
//   target = L < lo ? fg·257 : L > hi ? bg·257 : 32768
//   out = target + (v − target)·keep
//   px  = clamp(v + (out − v)·cov, 0, 65535) as u16    (cov=1 ⇒ out; TRUNCATES)
//
// Fully bit-exact: every op is + − × ÷ or a clamp/compare — innocuous under f64→f32 double
// rounding (no trig, no sqrt). The two threshold comparisons are HARD decisions, so the exact f32
// luminance matters. `Math.fround` per sub-op reproduces the engine's f32 order.
// ─────────────────────────────────────────────────────────────

const fr = Math.fround;
/** The engine works in 16-bit; channel values span [0, 65535]. */
export const CHALK_CHARCOAL_MAX = 65535;

/** Rec.601 luminance weights as f32 literals (engine `0.299/0.587/0.114`). */
const C_R = fr(0.299);
const C_G = fr(0.587);
const C_B = fr(0.114);
/** The fixed mid-tone (50% grey) third colour. */
export const CHALK_CHARCOAL_MID = 32768;

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Luminance of a grey pixel `v` (R=G=B=v), in [0,1], in the engine's f32 order:
 *  `((v·C_R + v·C_G) + v·C_B) / 65535`. Exposed for testing. */
export function chalkCharcoalLum(v: number): number {
  return fr(fr(fr(fr(v * C_R) + fr(v * C_G)) + fr(v * C_B)) / 65535);
}

/** The 16-bit tone colour chosen for luminance `l`: foreground (`fg16`) below `lo`, background
 *  (`bg16`) above `hi`, else the mid grey. Strict comparisons — l==lo and l==hi fall through to
 *  the brighter branch. Exposed for testing. */
export function chalkCharcoalTarget(l: number, lo: number, hi: number, fg16: number, bg16: number): number {
  return l < lo ? fg16 : l > hi ? bg16 : CHALK_CHARCOAL_MID;
}

/** The Chalk & Charcoal output for a single (grey) pixel value `v`, with grey foreground `fg` and
 *  background `bg` (u8, 0..255). Exposed for isolated testing. */
export function chalkCharcoalPixel(
  v: number,
  charcoalArea: number,
  chalkArea: number,
  strokePressure: number,
  fg: number,
  bg: number,
): number {
  const lo = clamp01(fr(charcoalArea));
  const hi = fr(1 - clamp01(fr(chalkArea)));
  const keep = fr(1 - clamp01(fr(strokePressure)));
  const fg16 = fg * 257; // u8 → u16 (exact: 255·257 = 65535)
  const bg16 = bg * 257;
  const l = chalkCharcoalLum(v);
  const target = chalkCharcoalTarget(l, lo, hi, fg16, bg16);
  const out = fr(target + fr(fr(v - target) * keep));
  const blended = fr(v + fr(out - v)); // cov = 1 (full selection)
  return Math.trunc(blended < 0 ? 0 : blended > CHALK_CHARCOAL_MAX ? CHALK_CHARCOAL_MAX : blended);
}

/** Apply Chalk & Charcoal to a single-channel (grey) 2-D image (u16 values 0..65535). `fg`/`bg`
 *  are grey foreground/background colours in [0,255] (default Photoshop black/white). Does not
 *  mutate the input. */
export function chalkCharcoal2D(
  image: readonly (readonly number[])[],
  charcoalArea: number,
  chalkArea: number,
  strokePressure: number,
  fg = 0,
  bg = 255,
): number[][] {
  return image.map((row) => row.map((v) => chalkCharcoalPixel(v, charcoalArea, chalkArea, strokePressure, fg, bg)));
}
