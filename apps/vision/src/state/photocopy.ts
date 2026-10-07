// ─────────────────────────────────────────────────────────────
// Photocopy (Filter ▸ Sketch ▸ Photocopy) — reduces the image to a two-tone "photocopied"
// look: a pixel is inked with the FOREGROUND colour where it is a dark detail relative to its
// surroundings (its local-average luminance is more than `thr` BRIGHTER than the pixel
// itself), and the BACKGROUND colour everywhere else. Deterministic; engine-free so it
// unit-tests in node.
//
// The criterion is driven by LUMINANCE (Rec.601 over R,G,B) and the output is a fg/bg colour,
// so this couples the channels — like Smart Blur, this reference models a single LUMINANCE
// channel: each value v is a grey pixel R=G=B=v, for which luminance reduces to its own
// self-weighting `(v·0.299 + v·0.587 + v·0.114)/65535`, and `fg`/`bg` are that channel's 8-bit
// values. On a grey image this matches `photocopy` bit-for-bit.
//
// MUST match `filters.rs photocopy` (grey domain, full selection ⇒ straight replace):
//   r = max(detail, 1),   thr = 0.5 / max(darkness, 0.1)
//   per pixel: lc = lum(c);  avg = mean of lum over the (2r+1)² edge-clamped window
//   out = (avg − lc > thr) ? fg·257 : bg·257     (inked where the pixel is a dark detail)
//
// Unlike Stamp (which thresholds the smoothed luminance against a fixed balance), Photocopy
// thresholds the LOCAL CONTRAST `avg − lc`, so it inks edges/detail rather than tonal regions.
// The comparison `avg − lc > thr` is the one hard decision; everything is f32. `thr = fr(0.5/…)`
// is provably bit-exact to the engine's f32 divide for EVERY `darkness` — the power-of-two
// numerator means the f64→f32 division never double-rounds — so even this hard decision is
// bit-exact. Mirrors the `stamp.ts` / Rec.601 house style.
// ─────────────────────────────────────────────────────────────

const fr = Math.fround;
/** The engine works in 16-bit; channel values span [0, 65535]. */
export const PHOTOCOPY_MAX = 65535;

/** Rec.601 luminance weights as f32 literals (engine `0.299/0.587/0.114`). */
const C_R = Math.fround(0.299);
const C_G = Math.fround(0.587);
const C_B = Math.fround(0.114);
/** Minimum darkness (engine `darkness.max(0.1)`), as f32. */
const MIN_DARKNESS = Math.fround(0.1);

/** Luminance of a grey pixel `v` (R=G=B=v), in [0,1], in the engine's f32 order. */
const lum = (v: number): number =>
  fr(fr(fr(fr(v * C_R) + fr(v * C_G)) + fr(v * C_B)) / 65535);

const clampIdx = (v: number, hi: number): number => (v < 0 ? 0 : v > hi ? hi : v);

/** The contrast threshold `0.5 / max(darkness, 0.1)`. Exposed so the mapping is unit-testable
 *  (higher darkness → lower threshold → more pixels inked). */
export function photocopyThreshold(darkness: number): number {
  return fr(0.5 / Math.max(fr(darkness), MIN_DARKNESS));
}

/** The Photocopy output for a single (grey/luminance) pixel `(x, y)`: the foreground value if
 *  its local-average luminance exceeds its own by more than `thr` (a dark detail), else the
 *  background value (both 8-bit, widened ·257). Exposed for isolated testing. Precondition:
 *  `image` non-empty and `(x,y)` in bounds (`photocopy2D` guarantees this). */
export function photocopyPixel(
  image: readonly (readonly number[])[],
  x: number,
  y: number,
  detail: number,
  darkness: number,
  fg: number,
  bg: number,
): number {
  const h = image.length;
  const w = image[0].length;
  const r = Math.max(Math.trunc(detail), 1);
  const thr = photocopyThreshold(darkness);
  const lc = lum(image[y][x]);
  let sum = 0;
  let cnt = 0;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      sum = fr(sum + lum(image[clampIdx(y + dy, h - 1)][clampIdx(x + dx, w - 1)]));
      cnt += 1;
    }
  }
  const avg = fr(sum / cnt);
  return fr(avg - lc) > thr ? fg * 257 : bg * 257; // dark detail → fg, else bg; ·257 widens u8→u16
}

/** Apply Photocopy to a single-channel (luminance) 2-D image (u16 values 0..65535). `fg`/`bg`
 *  are the 8-bit foreground/background values for this channel. */
export function photocopy2D(
  image: readonly (readonly number[])[],
  detail: number,
  darkness: number,
  fg: number,
  bg: number,
): number[][] {
  const h = image.length;
  const w = h > 0 ? image[0].length : 0;
  const out = image.map((row) => [...row]);
  if (w === 0) return out;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out[y][x] = photocopyPixel(image, x, y, detail, darkness, fg, bg);
    }
  }
  return out;
}
