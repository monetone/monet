// ─────────────────────────────────────────────────────────────
// styleBlend.ts — post-blend maths for Style Transfer (VIS-FX-15).
//
// The bundled fast-neural-style nets are baked one-per-style with no
// conditioning input, so the *network* has no strength knob. Photoshop's
// Strength / Preserve Color sliders are pure post-blends of the stylized
// pixels against the pre-filter composite, which is exactly what this
// does — no second model, no second inference pass.
// ─────────────────────────────────────────────────────────────

export interface StyleBlendOpts {
  /** 0 = untouched original, 1 = full stylization (default — today's behaviour). */
  strength?: number;
  /** 0 = the net's colours, 1 = original colours carrying the style's luminance. */
  preserveColor?: number;
  /** Opacity of the stamped style layer, 0..1 (default 1). Applied as a live
   *  layer property rather than baked, so it stays re-editable afterwards. */
  styleOpacity?: number;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clamp8 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);
// Rec.709 luma, matching the engine's luminance maths (raster/mod.rs).
const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * Blend `styled` (mutated in place and returned) against `original` — both
 * straight RGBA8 buffers of the same size.
 *
 * Preserve Color runs first, Luminosity-style: the original pixel shifted so it
 * carries the stylized luma, which keeps the brushwork but drops the palette.
 * Strength then lerps the whole result back toward the original. Alpha is left
 * alone — the stylized stamp covers the canvas.
 */
export function blendStyle(
  styled: Uint8ClampedArray,
  original: Uint8ClampedArray,
  opts?: StyleBlendOpts,
): Uint8ClampedArray {
  const strength = clamp01(opts?.strength ?? 1);
  const preserve = clamp01(opts?.preserveColor ?? 0);
  if (strength === 1 && preserve === 0) return styled; // no-op fast path
  const n = Math.min(styled.length, original.length);
  for (let p = 0; p < n; p += 4) {
    const sr = styled[p], sg = styled[p + 1], sb = styled[p + 2];
    const or = original[p], og = original[p + 1], ob = original[p + 2];
    let tr = sr, tg = sg, tb = sb;
    if (preserve > 0) {
      const d = luma(sr, sg, sb) - luma(or, og, ob);
      tr = sr + (clamp8(or + d) - sr) * preserve;
      tg = sg + (clamp8(og + d) - sg) * preserve;
      tb = sb + (clamp8(ob + d) - sb) * preserve;
    }
    styled[p] = or + (tr - or) * strength;
    styled[p + 1] = og + (tg - og) * strength;
    styled[p + 2] = ob + (tb - ob) * strength;
  }
  return styled;
}
