// Matte-composite: keep `fg` where the matte is opaque (255), show `bg` where
// it's transparent (0), feathering through the matte's soft edge. All three are
// straight RGBA8 of the same w×h. Used by Generate Background — the subject
// (fg, kept via its U²-Net matte) over a freshly generated backdrop (bg).
export function matteComposite(
  fg: Uint8ClampedArray,
  bg: Uint8ClampedArray,
  matte: Uint8Array,
  w: number,
  h: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) {
    const a = matte[p] / 255, dp = p * 4;
    out[dp] = fg[dp] * a + bg[dp] * (1 - a);
    out[dp + 1] = fg[dp + 1] * a + bg[dp + 1] * (1 - a);
    out[dp + 2] = fg[dp + 2] * a + bg[dp + 2] * (1 - a);
    out[dp + 3] = 255;
  }
  return out;
}
