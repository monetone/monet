// ─────────────────────────────────────────────────────────────
// Halftone Pattern (Filter ▸ Sketch ▸ Halftone Pattern) — re-screens the image as a two-tone
// halftone: a repeating SCREEN (dots, lines, or concentric circles) is compared against the local
// TONE; where the screen exceeds the tone the foreground ink shows, elsewhere the background. The
// result is a classic newsprint/comic screen in the chosen fg/bg colours. Deterministic; engine-
// free so it unit-tests in node.
//
// Tone is LUMINANCE (Rec.601), and the ink/paper are flat colours, so a grey image (R=G=B) with
// grey fg/bg matches `halftone_pattern` bit-for-bit — modelled here as one channel. The whole
// filter reduces to one HARD decision per pixel (`screen > t` → fg, else bg), so the exact f32
// screen and tone are load-bearing.
//
// MUST match `filters.rs halftone_pattern` (grey domain, full selection ⇒ cov 1):
//   cell = max(size,1);  k = 1 + 6·clamp(contrast,0,1);  fg16/bg16 = fg/bg·257;  cx = W/2;  cy = H/2
//   luma = (v·0.299 + v·0.587 + v·0.114)/65535;  t = clamp((luma−0.5)·k + 0.5, 0, 1)
//   tri(f) = 1 − |frac(f)·2 − 1|                 (triangle wave, peak at mid-period)
//   screen = Dot(1):    clamp(1 − sqrt(dx²+dy²)/0.7071, 0, 1),  dx = frac(x/cell)−0.5, dy likewise
//            Line(2):   tri(y/cell)
//            Circle(_): tri(hypot(x−cx, y−cy)/cell)
//   out = (screen > t) ? fg16 : bg16             (the cov=1 lerp v+(c−v) gives c exactly)
//
// Bit-exact on the engine's domain (integer x,y in 0..w / 0..h; finite size ≥ 0; the screens and
// contrast stay non-negative): every op is + − × ÷ rem, a clamp/compare, or sqrt/hypot. sqrt is
// IEEE-correctly-rounded, so `fround(Math.sqrt)` == `f32::sqrt` (double-rounding theorem). hypot is
// NOT guaranteed correctly-rounded by either spec, but for the integer/half-integer dx,dy reached
// here `Math.hypot` equals the correctly-rounded f32 result (verified by a wide sweep + the engine
// Circle goldens). `Math.fround` per sub-op reproduces the engine's f32 evaluation order; the per-op
// frounds are individually load-bearing (a full f32-vs-f64 sweep flips thousands of pixels). `%` is
// exact (fmod) and matches Rust `rem_euclid` only because every dividend here is ≥ 0 — so
// `halftoneScreen` must not be called with negative coordinates.
// ─────────────────────────────────────────────────────────────

const fr = Math.fround;
/** The engine works in 16-bit; channel values span [0, 65535]. */
export const HALFTONE_PATTERN_MAX = 65535;

/** Rec.601 luminance weights as f32 literals (engine `0.299/0.587/0.114`). */
const C_R = fr(0.299);
const C_G = fr(0.587);
const C_B = fr(0.114);
const HALF_DIAG = fr(0.7071); // half the cell diagonal (dot falloff radius)

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
/** Euclidean remainder for the non-negative coords/frequencies used here (= JS `%`, exact fmod). */
const rem = (a: number, b: number): number => a % b;

/** Triangle wave in [0,1], peaking at the middle of each unit period: `1 − |frac(f)·2 − 1|`. */
function tri(f: number): number {
  const s = fr(fr(rem(f, 1) * 2) - 1);
  return fr(1 - Math.abs(s));
}

/** The tone threshold `t = clamp((luma−0.5)·k + 0.5, 0, 1)` for grey pixel `v`, given `k`. Exposed. */
export function halftoneTone(v: number, k: number): number {
  const luma = fr(fr(fr(fr(C_R * v) + fr(C_G * v)) + fr(C_B * v)) / 65535);
  return clamp01(fr(fr(fr(luma - 0.5) * k) + 0.5));
}

/** The screen value in [0,1] at `(x, y)` for the chosen `pattern` (1 Dot, 2 Line, else Circle),
 *  given the cell size and image dims. Exposed for testing. */
export function halftoneScreen(x: number, y: number, pattern: number, cell: number, w: number, h: number): number {
  if (pattern === 1) {
    const dx = fr(fr(rem(x, cell) / cell) - 0.5);
    const dy = fr(fr(rem(y, cell) / cell) - 0.5);
    const d = fr(Math.sqrt(fr(fr(dx * dx) + fr(dy * dy))));
    return clamp01(fr(1 - fr(d / HALF_DIAG)));
  }
  if (pattern === 2) {
    return tri(fr(y / cell));
  }
  const cx = fr(w / 2);
  const cy = fr(h / 2);
  const hyp = fr(Math.hypot(fr(x - cx), fr(y - cy)));
  return tri(fr(hyp / cell));
}

/** The Halftone Pattern output for a single (grey) pixel `(x, y)` with value `v` and grey fg/bg
 *  (u8). Returns fg16 where the screen exceeds the tone, else bg16. Exposed for isolated testing. */
export function halftonePatternPixel(
  v: number,
  x: number,
  y: number,
  size: number,
  contrast: number,
  pattern: number,
  fg: number,
  bg: number,
  w: number,
  h: number,
): number {
  const cell = Math.max(fr(size), 1);
  const k = fr(1 + fr(6 * clamp01(fr(contrast))));
  const t = halftoneTone(v, k);
  const screen = halftoneScreen(x, y, pattern, cell, w, h);
  return screen > t ? fg * 257 : bg * 257;
}

/** Apply Halftone Pattern to a single-channel (grey) 2-D image (u16 values 0..65535) with grey
 *  foreground `fg` and background `bg` colours (u8). `size` ≥1 is the cell size, `contrast` ∈ [0,1]
 *  steepens the tone, `pattern` 1 Dot / 2 Line / else Circle. Does not mutate the input. */
export function halftonePattern2D(
  image: readonly (readonly number[])[],
  size: number,
  contrast: number,
  pattern: number,
  fg = 0,
  bg = 255,
): number[][] {
  const h = image.length;
  const w = h > 0 ? image[0].length : 0;
  if (w === 0) return image.map(() => []);
  return image.map((row, y) =>
    row.map((v, x) => halftonePatternPixel(v, x, y, size, contrast, pattern, fg, bg, w, h)),
  );
}
