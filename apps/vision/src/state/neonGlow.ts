// ─────────────────────────────────────────────────────────────
// Neon Glow (Filter ▸ Sketch ▸ Neon Glow) — recolours the image as a two-tone neon: dark areas
// ramp from black up to the GLOW colour, and light areas ramp from the glow colour up to white,
// the two halves meeting at a tone threshold `mid`. Deterministic; engine-free so it unit-tests in
// node.
//
// The split is driven by LUMINANCE (Rec.601 over R,G,B); the ramp is per channel toward the shared
// glow colour, so a grey image (R=G=B) with a grey glow colour matches `neon_glow` bit-for-bit —
// modelled here as one channel.
//
// MUST match `filters.rs neon_glow` (grey domain, full selection ⇒ cov 1):
//   mid = clamp(0.5 + 0.4·clamp(glow_size,−1,1), 0.1, 0.9)
//   br  = clamp(glow_brightness, 0, 1);  g = glow·257·br        (glow colour ×257 to u16, ×br)
//   L = (v·0.299 + v·0.587 + v·0.114) / 65535
//   out = L < mid ? g·(L/mid)                         // shadows: black → glow colour
//                 : g + (65535−g)·((L−mid)/(1−mid))   // highlights: glow colour → white
//   px  = clamp(v + (out − v)·cov, 0, 65535) as u16   (cov=1 ⇒ out; TRUNCATES)
//
// The two branches agree at L = mid (both give g), so the ramp is continuous; black → 0 and
// white → 65535 regardless of the glow colour. Fully bit-exact: every op is + − × ÷ or a
// clamp/cast (no trig, no sqrt); `Math.fround` per sub-op reproduces the engine's f32 order.
// ─────────────────────────────────────────────────────────────

const fr = Math.fround;
/** The engine works in 16-bit; channel values span [0, 65535]. */
export const NEON_GLOW_MAX = 65535;

/** Rec.601 luminance weights as f32 literals (engine `0.299/0.587/0.114`). */
const C_R = fr(0.299);
const C_G = fr(0.587);
const C_B = fr(0.114);
const MID_LO = fr(0.1);
const MID_HI = fr(0.9);
const HALF = fr(0.5);
const SLOPE = fr(0.4);

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const clampU16 = (x: number): number => (x < 0 ? 0 : x > NEON_GLOW_MAX ? NEON_GLOW_MAX : x);

/** The tone split point `mid = clamp(0.5 + 0.4·clamp(glow_size,−1,1), 0.1, 0.9)`. Exposed for
 *  testing. Larger `glow_size` pushes the glow into the highlights. */
export function neonGlowMid(glowSize: number): number {
  const s = (() => {
    const v = fr(glowSize);
    return v < -1 ? -1 : v > 1 ? 1 : v;
  })();
  const m = fr(HALF + fr(SLOPE * s));
  return m < MID_LO ? MID_LO : m > MID_HI ? MID_HI : m;
}

/** Luminance (in [0,1]) of a grey pixel `v` (R=G=B=v), in the engine's f32 order. */
function lum(v: number): number {
  return fr(fr(fr(fr(v * C_R) + fr(v * C_G)) + fr(v * C_B)) / 65535);
}

/** The Neon Glow output for a single (grey) pixel value `v`, with grey glow colour `glowColor`
 *  (u8, 0..255). Exposed for isolated testing. */
export function neonGlowPixel(
  v: number,
  glowSize: number,
  glowBrightness: number,
  glowColor: number,
): number {
  const mid = neonGlowMid(glowSize);
  const br = clamp01(fr(glowBrightness));
  const g = fr(fr(glowColor * 257) * br);
  const l = lum(v);
  const out =
    l < mid
      ? fr(g * fr(l / mid)) // shadows: black → glow colour
      : fr(g + fr(fr(NEON_GLOW_MAX - g) * fr(fr(l - mid) / fr(1 - mid)))); // highlights: glow → white
  const blended = fr(v + fr(out - v)); // cov = 1 (full selection)
  return Math.trunc(clampU16(blended));
}

/** Apply Neon Glow to a single-channel (grey) 2-D image (u16 values 0..65535) with a grey glow
 *  colour `glowColor` (u8). Does not mutate the input. */
export function neonGlow2D(
  image: readonly (readonly number[])[],
  glowSize: number,
  glowBrightness: number,
  glowColor: number,
): number[][] {
  return image.map((row) => row.map((v) => neonGlowPixel(v, glowSize, glowBrightness, glowColor)));
}
