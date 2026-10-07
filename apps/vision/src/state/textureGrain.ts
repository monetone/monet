// ─────────────────────────────────────────────────────────────
// Texture Grain (Filter ▸ Texture ▸ Grain) — overlays procedural film grain. Nine grain types,
// all derived from a deterministic POSITION hash (no RNG state), so the grain is reproducible.
// Most types add a signed monochromatic delta to every channel; two (Sprinkles/Stippled) blend
// scattered specks toward a background colour. Deterministic; engine-free so it unit-tests in node.
//
// The grain is position-driven and (for additive types) channel-independent, so on a grey image
// (R=G=B) with a grey background colour this matches `texture_grain` bit-for-bit — modelled here as
// one value channel + a grey bg.
//
// MUST match `filters.rs texture_grain` (full selection ⇒ cov 1):
//   it = clamp(intensity,0,1);  it ≤ 0 → no-op.  ct = clamp(contrast,0,1)
//   amp = it·0.6·65535;  cgain = 1 + 2·ct;  blend = 0.5 + 0.5·ct;  thr = 1 − it·0.5;  bg16 = bg·257
//   per pixel: a per-type `dn` (additive) or a speck test, built from tex_hash / tex_noise:
//     additive: d = clamp(dn·cgain, −1, 1)·amp·cov;  out = clamp(v + d, 0, 65535)
//     speck (types 2,6): if (noise|hash) > thr → out = clamp(v + (bg16−v)·blend·cov, 0, 65535)
//
// `tex_hash` is integer-exact (u32 wrapping arithmetic, reproduced with Math.imul/>>>), and
// `tex_noise` is a bilinear smoothstep of four hash corners — so this is FULLY bit-exact (no trig,
// no sqrt). `Math.fround` per sub-op reproduces the engine's f32 order.
// ─────────────────────────────────────────────────────────────

const fr = Math.fround;
/** The engine works in 16-bit; channel values span [0, 65535]. */
export const TEXTURE_GRAIN_MAX = 65535;

// Octave coordinate scales as f32 literals — the engine computes `x as f32 * 0.12` in f32, and
// f32(0.12) ≠ f64(0.12), so the constant must be frounded BEFORE the multiply (0.25/0.5/0.05 below
// too; 0.25/0.5 are exact dyadic but 0.12/0.05 are not). Pre-rounding keeps types Clumped/Enlarged
// bit-exact on images wider than ~16px.
const K025 = fr(0.25);
const K012 = fr(0.12);
const K005 = fr(0.05);
const K050 = fr(0.5);

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const clampNeg1 = (x: number): number => (x < -1 ? -1 : x > 1 ? 1 : x);
const clampU16 = (x: number): number => (x < 0 ? 0 : x > TEXTURE_GRAIN_MAX ? TEXTURE_GRAIN_MAX : x);

/** Integer value-hash for lattice cell `(ix, iy)` → an f32 in [0,1]. Reproduces the engine's u32
 *  `wrapping_mul`/shift chain exactly via `Math.imul` and unsigned shifts. Exposed for testing. */
export function texHash(ix: number, iy: number): number {
  let n = (Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263)) >>> 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177) >>> 0;
  return fr(((n >>> 8) & 0xffff) / 65535);
}

/** Smooth value noise (bilinear smoothstep over the hash lattice) at `(x, y)` → f32 in [0,1].
 *  Exposed for testing. */
export function texNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = fr(x - ix);
  const fy = fr(y - iy);
  const sx = fr(fr(fx * fx) * fr(3 - fr(2 * fx))); // smoothstep
  const sy = fr(fr(fy * fy) * fr(3 - fr(2 * fy)));
  const a = texHash(ix, iy);
  const b = texHash(ix + 1, iy);
  const c = texHash(ix, iy + 1);
  const d = texHash(ix + 1, iy + 1);
  const ab = fr(a + fr(fr(b - a) * sx));
  const cd = fr(c + fr(fr(d - c) * sx));
  return fr(ab + fr(fr(cd - ab) * sy));
}

/** The signed grain delta `dn` ∈ [−1,1]-ish for additive grain types at `(x, y)`. Exposed for
 *  testing the per-type formulas. (Speck types 2/6 are handled in the pixel function.) */
export function textureGrainDelta(x: number, y: number, grainType: number, intensity: number): number {
  switch (grainType) {
    case 1: // Soft (low-freq)
      return fr(fr(texNoise(fr(x * K025), fr(y * K025)) - 0.5) * 2);
    case 3: // Clumped (two octaves)
      return fr(fr(fr(fr(texNoise(fr(x * K050), fr(y * K050)) + texNoise(fr(x * K012), fr(y * K012))) * 0.5) - 0.5) * 2);
    case 4: // Contrasty (steeper → saturates)
      return clampNeg1(fr(fr(texHash(x, y) - 0.5) * 4));
    case 5: // Enlarged (coarse cells)
      return fr(fr(texNoise(fr(x * K005), fr(y * K005)) - 0.5) * 2);
    case 7: // Horizontal (constant per row)
      return fr(fr(texHash(0, y) - 0.5) * 2);
    case 8: // Vertical (constant per column)
      return fr(fr(texHash(x, 0) - 0.5) * 2);
    case 9: // Speckle (sparse bimodal)
      if (texHash(x, y) < fr(clamp01(fr(intensity)) * fr(0.3))) {
        return texHash(x + 7, y + 3) < 0.5 ? -1 : 1;
      }
      return 0;
    default: // 0 Regular
      return fr(fr(texHash(x, y) - 0.5) * 2);
  }
}

/** The Texture Grain output for a single (grey) pixel value `v` at `(x, y)`, with grey background
 *  colour `bg` (u8). Exposed for isolated testing. */
export function textureGrainPixel(
  v: number,
  x: number,
  y: number,
  intensity: number,
  contrast: number,
  grainType: number,
  bg: number,
): number {
  const it = clamp01(fr(intensity));
  if (it <= 0) return v; // no-op
  const ct = clamp01(fr(contrast));
  // Speck types: scatter background-colour specks where the field exceeds the threshold.
  if (grainType === 2 || grainType === 6) {
    const thr = fr(1 - fr(it * 0.5));
    const field = grainType === 2 ? texNoise(fr(x * K050), fr(y * K050)) : texHash(x, y);
    if (field > thr) {
      const blend = fr(0.5 + fr(0.5 * ct));
      const bg16 = bg * 257;
      return Math.trunc(clampU16(fr(v + fr(fr(bg16 - v) * blend)))); // cov = 1
    }
    return v;
  }
  // Additive monochromatic grain.
  const amp = fr(fr(it * fr(0.6)) * 65535);
  const cgain = fr(1 + fr(2 * ct));
  const dn = textureGrainDelta(x, y, grainType, intensity);
  const d = fr(clampNeg1(fr(dn * cgain)) * amp); // ·cov, cov = 1
  return Math.trunc(clampU16(fr(v + d)));
}

/** Apply Texture Grain to a single-channel (grey) 2-D image (u16 values 0..65535) with a grey
 *  background colour `bg` (u8). `grainType` 0..9 (0 Regular, 1 Soft, 2 Sprinkles, 3 Clumped,
 *  4 Contrasty, 5 Enlarged, 6 Stippled, 7 Horizontal, 8 Vertical, 9 Speckle). Does not mutate. */
export function textureGrain2D(
  image: readonly (readonly number[])[],
  intensity: number,
  contrast: number,
  grainType: number,
  bg = 128,
): number[][] {
  return image.map((row, y) =>
    row.map((v, x) => textureGrainPixel(v, x, y, intensity, contrast, grainType, bg)),
  );
}
