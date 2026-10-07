// ─────────────────────────────────────────────────────────────
// Graphic Pen (Filter ▸ Sketch ▸ Graphic Pen) — redraws the image as fine diagonal ink
// strokes on paper: darker areas get denser foreground hatching, lighter areas more
// background. Each pixel is foreground where its "darkness" exceeds a periodic ramp running
// along the stroke direction, and background otherwise. Deterministic; engine-free so it
// unit-tests in node.
//
// The criterion is driven by LUMINANCE (Rec.601 over R,G,B) and the output is a fg/bg colour,
// so this couples the channels — like Smart Blur, this reference models a single LUMINANCE
// channel: each value v is a grey pixel R=G=B=v, for which luminance reduces to its own
// self-weighting `(v·0.299 + v·0.587 + v·0.114)/65535`, and `fg`/`bg` are that channel's 8-bit
// values. On a grey image this matches `graphic_pen` bit-for-bit.
//
// MUST match `filters.rs graphic_pen` (grey domain, full selection ⇒ straight replace):
//   spacing = 2 + 10·clamp(strokeLength, 0, 1),   bal = clamp(balance, 0, 1) − 0.5
//   darkness = clamp(1 − luma + bal, 0, 1)
//   coord = direction 1 → y,  2 → x−y,  3 → x,  else → x+y
//   ramp = rem_euclid(coord, spacing) / spacing          (a 0..1 sawtooth across the strokes)
//   out = (darkness > ramp) ? fg·257 : bg·257
//
// Unlike Stamp/Photocopy this is FULLY bit-exact: every op is + − × ÷ rem or a compare, all of
// which are innocuous under f64→f32 double rounding (53 ≥ 2·24+2), so even the hard decision
// `darkness > ramp` matches the engine exactly — no trig, no sqrt. Mirrors the `stamp.ts` /
// Rec.601 house style.
// ─────────────────────────────────────────────────────────────

const fr = Math.fround;
/** The engine works in 16-bit; channel values span [0, 65535]. */
export const GRAPHIC_PEN_MAX = 65535;

/** Rec.601 luminance weights as f32 literals (engine `0.299/0.587/0.114`). */
const C_R = Math.fround(0.299);
const C_G = Math.fround(0.587);
const C_B = Math.fround(0.114);

/** Luminance of a grey pixel `v` (R=G=B=v), in [0,1], in the engine's f32 order. */
const lum = (v: number): number =>
  fr(fr(fr(fr(C_R * v) + fr(C_G * v)) + fr(C_B * v)) / 65535);

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** The stroke spacing `2 + 10·clamp(strokeLength, 0, 1)` (2..12 px). Exposed for testing. */
export function graphicPenSpacing(strokeLength: number): number {
  return fr(2 + fr(10 * clamp01(fr(strokeLength))));
}

/** The Graphic-Pen output for a single (grey/luminance) pixel `(x, y)`: foreground where its
 *  darkness exceeds the local stroke ramp, else background (both 8-bit, widened ·257). Exposed
 *  for isolated testing. Precondition: `image` non-empty and `(x,y)` in bounds. */
export function graphicPenPixel(
  image: readonly (readonly number[])[],
  x: number,
  y: number,
  strokeLength: number,
  balance: number,
  direction: number,
  fg: number,
  bg: number,
): number {
  const spacing = graphicPenSpacing(strokeLength);
  const bal = fr(clamp01(fr(balance)) - 0.5);
  const darkness = clamp01(fr(fr(1 - lum(image[y][x])) + bal));
  let coord: number;
  switch (Math.trunc(direction)) {
    case 1:
      coord = fr(y);
      break;
    case 2:
      coord = fr(x - y);
      break;
    case 3:
      coord = fr(x);
      break;
    default:
      coord = fr(x + y);
  }
  let r = fr(coord % spacing); // rem_euclid: f32 fmod, then lift into [0, spacing)
  if (r < 0) r = fr(r + spacing);
  const ramp = fr(r / spacing);
  return darkness > ramp ? fg * 257 : bg * 257; // dark > ramp → fg ink, else bg; ·257 widens u8→u16
}

/** Apply Graphic Pen to a single-channel (luminance) 2-D image (u16 values 0..65535). `fg`/`bg`
 *  are the 8-bit foreground/background values for this channel. */
export function graphicPen2D(
  image: readonly (readonly number[])[],
  strokeLength: number,
  balance: number,
  direction: number,
  fg: number,
  bg: number,
): number[][] {
  const h = image.length;
  const w = h > 0 ? image[0].length : 0;
  const out = image.map((row) => [...row]);
  if (w === 0) return out;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out[y][x] = graphicPenPixel(image, x, y, strokeLength, balance, direction, fg, bg);
    }
  }
  return out;
}
