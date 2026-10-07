// ─────────────────────────────────────────────────────────────
// Display compensation LUT (View-side) — trilinear sampling of the engine's
// document-profile → sRGB 3D LUT (`engine.display_lut(n, icc)`: n³ RGB u8
// triples, R fastest, then G, then B). The canvas blit path remaps pixels
// through this so non-sRGB documents PRESENT correctly; the engine composite
// (pick_color, exports) keeps raw document values. Engine-free; unit-tests
// in node.
// ─────────────────────────────────────────────────────────────

/** Lattice size requested from the engine: 33³ ≈ 108 KB, the standard
 *  profile-LUT resolution (matches .cube conventions). */
export const DISPLAY_LUT_SIZE = 33;

/** Recover the lattice size from a packed LUT's byte length (n³·3), or null
 *  when the buffer is not a valid packed LUT. */
export function lutSizeFor(lut: Uint8Array): number | null {
  for (let n = 2; n <= 65; n++) if (n * n * n * 3 === lut.length) return n;
  return null;
}

/** Sample the LUT at an 8-bit RGB coordinate with trilinear interpolation. */
export function sampleDisplayLut(
  lut: Uint8Array,
  n: number,
  r: number,
  g: number,
  b: number,
): [number, number, number] {
  const scale = (n - 1) / 255;
  const fr = r * scale, fg = g * scale, fb = b * scale;
  const r0 = Math.min(Math.floor(fr), n - 1), g0 = Math.min(Math.floor(fg), n - 1), b0 = Math.min(Math.floor(fb), n - 1);
  const r1 = Math.min(r0 + 1, n - 1), g1 = Math.min(g0 + 1, n - 1), b1 = Math.min(b0 + 1, n - 1);
  const tr = fr - r0, tg = fg - g0, tb = fb - b0;
  const idx = (ri: number, gi: number, bi: number) => ((bi * n + gi) * n + ri) * 3;
  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    // Interpolate along R, then G, then B.
    const c000 = lut[idx(r0, g0, b0) + c], c100 = lut[idx(r1, g0, b0) + c];
    const c010 = lut[idx(r0, g1, b0) + c], c110 = lut[idx(r1, g1, b0) + c];
    const c001 = lut[idx(r0, g0, b1) + c], c101 = lut[idx(r1, g0, b1) + c];
    const c011 = lut[idx(r0, g1, b1) + c], c111 = lut[idx(r1, g1, b1) + c];
    const c00 = c000 + (c100 - c000) * tr, c10 = c010 + (c110 - c010) * tr;
    const c01 = c001 + (c101 - c001) * tr, c11 = c011 + (c111 - c011) * tr;
    const c0 = c00 + (c10 - c00) * tg, c1 = c01 + (c11 - c01) * tg;
    out[c] = Math.round(c0 + (c1 - c0) * tb);
  }
  return out;
}

/** Recover the lattice size of a PROOF LUT (n³·4: RGB + gamut byte). */
export function proofLutSizeFor(lut: Uint8Array): number | null {
  for (let n = 2; n <= 65; n++) if (n * n * n * 4 === lut.length) return n;
  return null;
}

/** Sample an ICC proof LUT: trilinear on the proofed RGB, nearest-neighbour on
 *  the gamut byte (a binary flag — interpolating it would invent values). */
export function sampleProofLut(
  lut: Uint8Array,
  n: number,
  r: number,
  g: number,
  b: number,
): [number, number, number, number] {
  const scale = (n - 1) / 255;
  const fr = r * scale, fg = g * scale, fb = b * scale;
  const r0 = Math.min(Math.floor(fr), n - 1), g0 = Math.min(Math.floor(fg), n - 1), b0 = Math.min(Math.floor(fb), n - 1);
  const r1 = Math.min(r0 + 1, n - 1), g1 = Math.min(g0 + 1, n - 1), b1 = Math.min(b0 + 1, n - 1);
  const tr = fr - r0, tg = fg - g0, tb = fb - b0;
  const idx = (ri: number, gi: number, bi: number) => ((bi * n + gi) * n + ri) * 4;
  const out: [number, number, number, number] = [0, 0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const c000 = lut[idx(r0, g0, b0) + c], c100 = lut[idx(r1, g0, b0) + c];
    const c010 = lut[idx(r0, g1, b0) + c], c110 = lut[idx(r1, g1, b0) + c];
    const c001 = lut[idx(r0, g0, b1) + c], c101 = lut[idx(r1, g0, b1) + c];
    const c011 = lut[idx(r0, g1, b1) + c], c111 = lut[idx(r1, g1, b1) + c];
    const c00 = c000 + (c100 - c000) * tr, c10 = c010 + (c110 - c010) * tr;
    const c01 = c001 + (c101 - c001) * tr, c11 = c011 + (c111 - c011) * tr;
    const c0 = c00 + (c10 - c00) * tg, c1 = c01 + (c11 - c01) * tg;
    out[c] = Math.round(c0 + (c1 - c0) * tb);
  }
  out[3] = lut[idx(
    tr < 0.5 ? r0 : r1,
    tg < 0.5 ? g0 : g1,
    tb < 0.5 ? b0 : b1,
  ) + 3];
  return out;
}
