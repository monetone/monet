// ─────────────────────────────────────────────────────────────
// Angled Strokes (Filter ▸ Brush Strokes ▸ Angled Strokes) — repaints the image with diagonal
// brush strokes whose ANGLE depends on tone: light areas are stroked along one diagonal, dark
// areas along the other. It is a directional box-blur along that per-pixel diagonal, blended
// back toward the original by `sharpness`. Deterministic; engine-free so it unit-tests in node.
//
// The stroke direction is chosen by LUMINANCE (Rec.601 over R,G,B); the blur is per channel
// along that shared diagonal, so on a grey image (R=G=B=v, luminance = the channel's own
// self-weighting) this matches `angled_strokes` bit-for-bit — modelled here as one channel.
//
// MUST match `filters.rs angled_strokes` (grey domain, full selection ⇒ cov 1):
//   len = max(length, 0);  len == 0 → identity (no strokes)
//   thr = clamp(balance,0,1);  keep = clamp(sharpness,0,1)
//   per pixel: dir = lum(c) ≥ thr ? 1 : −1            (light → (1,1), dark → (1,−1))
//     blurred = mean of src over the line (x+k, y+k·dir), k ∈ [−len, len], edge-clamped
//     out = blurred + (orig − blurred)·keep           (sharpness keeps the original)
//     px = clamp(orig + (out − orig)·cov, 0, 65535) as u16   (cov=1 ⇒ out; TRUNCATES)
//
// Fully bit-exact: every op is + − × ÷ or a clamp/compare — all innocuous under f64→f32 double
// rounding (no trig, no sqrt). The `dir` decision has TWO branches (light vs dark); both are
// exercised by any mixed-tone image. Mirrors the `boxBlur.ts` / Rec.601 house style.
// ─────────────────────────────────────────────────────────────

const fr = Math.fround;
/** The engine works in 16-bit; channel values span [0, 65535]. */
export const ANGLED_STROKES_MAX = 65535;

/** Rec.601 luminance weights as f32 literals (engine `0.299/0.587/0.114`). */
const C_R = Math.fround(0.299);
const C_G = Math.fround(0.587);
const C_B = Math.fround(0.114);

/** Luminance of a grey pixel `v` (R=G=B=v), in [0,1], in the engine's f32 order. */
const lum = (v: number): number =>
  fr(fr(fr(fr(v * C_R) + fr(v * C_G)) + fr(v * C_B)) / 65535);

const clampIdx = (v: number, hi: number): number => (v < 0 ? 0 : v > hi ? hi : v);
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** The Angled-Strokes output for a single (grey/luminance) pixel `(x, y)`: a directional blur
 *  along the tone-chosen diagonal, blended toward the original by `sharpness`. Exposed for
 *  isolated testing. Precondition: `image` non-empty and `(x,y)` in bounds. */
export function angledStrokesPixel(
  image: readonly (readonly number[])[],
  x: number,
  y: number,
  length: number,
  balance: number,
  sharpness: number,
): number {
  const orig = image[y][x];
  const len = Math.max(Math.trunc(length), 0);
  if (len === 0) return orig; // no strokes → identity
  const h = image.length;
  const w = image[0].length;
  const thr = clamp01(fr(balance));
  const keep = clamp01(fr(sharpness));
  const dir = lum(orig) >= thr ? 1 : -1; // light → (1,1), dark → (1,−1)
  let sum = 0;
  let cnt = 0;
  for (let k = -len; k <= len; k++) {
    sum = fr(sum + image[clampIdx(y + k * dir, h - 1)][clampIdx(x + k, w - 1)]);
    cnt += 1;
  }
  const blurred = fr(sum / cnt);
  const out = fr(blurred + fr(fr(orig - blurred) * keep));
  const blended = fr(orig + fr(out - orig)); // cov = 1 (full selection)
  return Math.trunc(blended < 0 ? 0 : blended > ANGLED_STROKES_MAX ? ANGLED_STROKES_MAX : blended);
}

/** Apply Angled Strokes to a single-channel (luminance) 2-D image (u16 values 0..65535). */
export function angledStrokes2D(
  image: readonly (readonly number[])[],
  length: number,
  balance: number,
  sharpness: number,
): number[][] {
  const h = image.length;
  const w = h > 0 ? image[0].length : 0;
  const out = image.map((row) => [...row]);
  if (w === 0) return out;
  if (Math.max(Math.trunc(length), 0) === 0) return out; // no-op (engine early return)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out[y][x] = angledStrokesPixel(image, x, y, length, balance, sharpness);
    }
  }
  return out;
}
