// ─────────────────────────────────────────────────────────────
// Remove Matte (Layer ▸ Matting ▸ Remove White Matte / Remove Black Matte) — cleans the coloured
// halo left around a layer that was composited (matted) against a white or black background. It
// is a pure PER-PIXEL operation, and — uniquely among these mirrors — it depends on the ALPHA
// channel: it un-premultiplies the matte colour from the *partial-alpha edge* pixels only.
// Deterministic; engine-free so it unit-tests in node.
//
// Each RGB channel is independent given the pixel's alpha `a`, so the atomic unit is one
// channel + alpha. Interior pixels (fully opaque a=1) and fully-transparent pixels (a=0) are
// left untouched — only the antialiased edge (0 < a < 1) carries matte bleed to remove.
//
// MUST match `filters.rs remove_matte` (full selection ⇒ cov 1; alpha preserved):
//   af = a/65535;  if af ≤ 0 or af ≥ 1 → channel unchanged (not a matted edge pixel)
//   matte = white ? 1 : 0
//   out = to16( clamp( (c/65535 − matte·(1 − af)) / af , 0, 1) )
// where to16(x) = trunc(clamp(x,0,1)·65535 + 0.5), all in f32. Removing a WHITE matte subtracts
// the white bleed `(1−af)` before un-multiplying; a BLACK matte (matte=0) is a plain un-multiply
// `c/af` that brightens the dim edge.
//
// Fully bit-exact: every op is − × ÷ or a clamp/round — innocuous under f64→f32 double rounding
// (no trig, no sqrt). `Math.fround` per sub-op reproduces the engine's f32 order. The division is
// safe: af > 0 is guaranteed by the `af ≤ 0` skip.
// ─────────────────────────────────────────────────────────────

const fr = Math.fround;
/** The engine works in 16-bit; channel values span [0, 65535]. */
export const REMOVE_MATTE_MAX = 65535;

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Quantise an f32 fraction to u16 exactly like the engine's `to16` (f32 mul/add, truncating cast). */
function to16(x: number): number {
  const c = clamp01(x);
  return Math.trunc(fr(fr(c * 65535) + 0.5));
}

/** Un-matte a single channel value `c16` (u16) given the pixel alpha `a16` (u16). `white` selects
 *  the matte colour (true → white = 1, false → black = 0). Only partial-alpha pixels (0 < a < 1)
 *  are changed; fully opaque / fully transparent channels are returned unchanged. Exposed for
 *  testing — this is the bit-exact atomic unit. */
export function removeMatteChannel(c16: number, a16: number, white: boolean): number {
  const af = fr(a16 / 65535);
  if (af <= 0 || af >= 1) return c16; // not a matted edge pixel → unchanged
  const cv = fr(c16 / 65535);
  const matte = white ? 1 : 0;
  const sub = fr(cv - fr(matte * fr(1 - af))); // remove the matte bleed (white) / no-op (black)
  const un = fr(sub / af); // un-multiply by coverage
  return to16(clamp01(un));
}

/** An RGBA pixel as four u16 channels [r, g, b, a]. */
export type RGBA = readonly [number, number, number, number];

/** Remove Matte for a single RGBA pixel: un-mattes R,G,B with the shared alpha; alpha preserved. */
export function removeMattePixel(
  r: number,
  g: number,
  b: number,
  a: number,
  white: boolean,
): [number, number, number, number] {
  return [
    removeMatteChannel(r, a, white),
    removeMatteChannel(g, a, white),
    removeMatteChannel(b, a, white),
    a,
  ];
}

/** Apply Remove Matte to a 2-D image of RGBA pixels (u16 channels). Per pixel, no neighbourhood.
 *  Does not mutate the input. */
export function removeMatte2D(
  image: readonly (readonly RGBA[])[],
  white: boolean,
): [number, number, number, number][][] {
  return image.map((row) => row.map(([r, g, b, a]) => removeMattePixel(r, g, b, a, white)));
}
