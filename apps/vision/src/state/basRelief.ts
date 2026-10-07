// ─────────────────────────────────────────────────────────────
// Bas Relief (Filter ▸ Sketch ▸ Bas Relief) — re-lights the image as a carved stone relief:
// it (optionally) smooths the luminance, measures the surface slope along a chosen light
// direction, and shades each pixel between the foreground colour (in shadow) and the
// background colour (lit). Continuous output (a fg↔bg lerp, not two-tone). Deterministic;
// engine-free so it unit-tests in node.
//
// The relief is driven by LUMINANCE (Rec.601 over R,G,B) and the output lerps fg↔bg, so this
// couples the channels — like Smart Blur, this reference models a single LUMINANCE channel:
// each value v is a grey pixel R=G=B=v, for which luminance reduces to `(v·0.299 + v·0.587 +
// v·0.114)/65535`, and `fg`/`bg` are that channel's 8-bit values. On a grey image this matches
// `bas_relief` bit-for-bit.
//
// MUST match `filters.rs bas_relief` (grey domain):
//   r = clamp((clamp(smoothness,1,15) − 1) / 3, 0, 5)     (box-blur radius from Smoothness)
//   ls = r==0 ? lum : mean of lum over the (2r+1)² edge-clamped window
//   (ox,oy) = the light offset (1 TR, 2 R, 3 BR, 4 B, 5 BL, 6 L, 7 TL, else Top = (0,−1))
//   gain = 1.5 + 0.6·clamp(detail,1,15)                   (emboss gain 2.1 .. 10.5)
//   per pixel: slope = ls[+off] − ls[−off];  rel = clamp(0.5 + slope·gain, 0, 1)
//   out = clamp(fg·257 + (bg·257 − fg·257)·rel, 0, 65535) as u16     (TRUNCATES)
//
// Fully bit-exact: every op is + − × ÷ or a clamp/compare, all innocuous under f64→f32 double
// rounding (53 ≥ 2·24+2) — no trig, no sqrt. Mirrors the `cutout.ts` / Rec.601 house style.
// ─────────────────────────────────────────────────────────────

const fr = Math.fround;
/** The engine works in 16-bit; channel values span [0, 65535]. */
export const BAS_RELIEF_MAX = 65535;

/** Rec.601 luminance weights as f32 literals (engine `0.299/0.587/0.114`). */
const C_R = Math.fround(0.299);
const C_G = Math.fround(0.587);
const C_B = Math.fround(0.114);
const GAIN_K = Math.fround(0.6);

/** Luminance of a grey pixel `v` (R=G=B=v), in [0,1], in the engine's f32 order. */
const lum = (v: number): number =>
  fr(fr(fr(fr(v * C_R) + fr(v * C_G)) + fr(v * C_B)) / 65535);

const clampIdx = (v: number, hi: number): number => (v < 0 ? 0 : v > hi ? hi : v);
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Smoothing box radius from Smoothness (1..15): `clamp((s−1)/3, 0, 5)`. Exposed for testing. */
export function basReliefRadius(smoothness: number): number {
  const s = Math.min(Math.max(Math.trunc(smoothness), 1), 15);
  return Math.min(Math.max(Math.trunc((s - 1) / 3), 0), 5);
}

/** Emboss gain from Detail (1..15): `1.5 + 0.6·detail` (2.1 .. 10.5). Exposed for testing. */
export function basReliefGain(detail: number): number {
  const d = Math.min(Math.max(Math.trunc(detail), 1), 15);
  return fr(1.5 + fr(GAIN_K * d));
}

/** The light offset `(ox, oy)` the surface is lit FROM (engine `light: u8`): 1 TR, 2 R, 3 BR,
 *  4 B, 5 BL, 6 L, 7 TL, else Top. Exposed so all eight arms are unit-testable. */
export function basReliefLightOffset(light: number): [number, number] {
  switch (Math.trunc(light)) {
    case 1:
      return [1, -1]; // Top-Right
    case 2:
      return [1, 0]; // Right
    case 3:
      return [1, 1]; // Bottom-Right
    case 4:
      return [0, 1]; // Bottom
    case 5:
      return [-1, 1]; // Bottom-Left
    case 6:
      return [-1, 0]; // Left
    case 7:
      return [-1, -1]; // Top-Left
    default:
      return [0, -1]; // Top
  }
}

/** Build the (optionally box-smoothed) luminance field, exactly as the engine precomputes it. */
function lumField(image: readonly (readonly number[])[], r: number, w: number, h: number): number[][] {
  const ls = Array.from({ length: h }, () => new Array<number>(w).fill(0));
  if (r === 0) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) ls[y][x] = lum(image[y][x]);
    return ls;
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let cnt = 0;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          sum = fr(sum + lum(image[clampIdx(y + dy, h - 1)][clampIdx(x + dx, w - 1)]));
          cnt += 1;
        }
      }
      ls[y][x] = fr(sum / cnt);
    }
  }
  return ls;
}

/** Apply Bas Relief to a single-channel (luminance) 2-D image (u16 values 0..65535). `fg`/`bg`
 *  are the 8-bit foreground/background values for this channel. */
export function basRelief2D(
  image: readonly (readonly number[])[],
  detail: number,
  smoothness: number,
  light: number,
  fg: number,
  bg: number,
): number[][] {
  const h = image.length;
  const w = h > 0 ? image[0].length : 0;
  const out = image.map((row) => [...row]);
  if (w === 0) return out;
  const r = basReliefRadius(smoothness);
  const gain = basReliefGain(detail);
  const [ox, oy] = basReliefLightOffset(light);
  const fg16 = fr(fg * 257);
  const bg16 = fr(bg * 257);
  const span = fr(bg16 - fg16);
  const ls = lumField(image, r, w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = ls[clampIdx(y + oy, h - 1)][clampIdx(x + ox, w - 1)];
      const b = ls[clampIdx(y - oy, h - 1)][clampIdx(x - ox, w - 1)];
      const slope = fr(a - b); // >0 lit (→bg), <0 shadow (→fg)
      const rel = clamp01(fr(0.5 + fr(slope * gain)));
      const val = fr(fg16 + fr(span * rel));
      out[y][x] = Math.trunc(val < 0 ? 0 : val > BAS_RELIEF_MAX ? BAS_RELIEF_MAX : val);
    }
  }
  return out;
}
