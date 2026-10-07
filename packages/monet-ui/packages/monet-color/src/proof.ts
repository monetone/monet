// proof.ts — display-only soft-proof colour transforms for View ▸ Proof Setup.
//
// These map a composited sRGB pixel to the pixel the monitor should SHOW when a
// proof is active. They are applied in EngineClient.blit (over the bytes on
// their way to the canvas) and never touch the engine's real output, so save,
// export, histograms and thumbnails are unaffected — exactly how Photoshop's
// soft proofing works.
//
// Exact ICC gamut clipping needs the full colour-management subsystem. Until
// that lands, Gamut Warning uses a conservative profile-free press heuristic:
// saturated/high-chroma RGB colours that typical CMYK workflows cannot hold and
// over-inked CMYK separations are marked display-only. This never touches saved
// pixels and should be treated as a practical warning, not a proof contract.

export type ProofMode =
  | "cmyk" // Working CMYK soft proof (dot-gain tonal model)
  | "cyan"
  | "magenta"
  | "yellow"
  | "black"
  | "cmy" // CMY plates (drop the black plate)
  | "acescg" // OCIO ACEScg display transform approximation
  | "aces2065" // OCIO ACES2065-1 display transform approximation
  | "hdr-pq" // HDR display proof with PQ-style highlight rolloff
  | "hdr-hlg" // HDR display proof with HLG-style highlight rolloff
  | "gamma18" // Legacy Macintosh RGB (Gamma 1.8)
  | "srgb" // Internet Standard RGB: un-managed sRGB values
  | "monitor" // current host monitor profile (the canvas already performs this mapping)
  | "protanopia"
  | "deuteranopia";

export interface ProofOptions {
  simulatePaperColor?: boolean;
  simulateBlackInk?: boolean;
  /** Black Point Compensation — maps the source black point onto the proof's
   *  black point (baked into the ICC proof LUT, not applied display-side). */
  blackPointCompensation?: boolean;
  /** The working CMYK space being proofed: Color Settings ▸ Working Spaces ▸
   *  CMYK. Its dot gain and total ink limit are what make an uncoated stock
   *  look different from a coated one, so the proof reads them from here
   *  instead of assuming one press (#488). Omitted = SWOP, the old default. */
  press?: PressBehaviour;
}

/** The two press numbers the display proof models. Structural on purpose:
 *  CMYK_PROFILES entries satisfy it, and so does anything else that measures a
 *  press the same way. */
export interface PressBehaviour {
  /** Midtone dot gain, 0..1 — inks print fatter than their dot %. */
  readonly dotGain: number;
  /** Total area coverage limit, e.g. 3.0 for 300% ink. */
  readonly totalInkLimit: number;
}

// U.S. Web Coated (SWOP) v2, which is CMYK_PROFILES[0] and Photoshop's default
// working CMYK. Used when a caller names no press.
const SWOP: PressBehaviour = { dotGain: 0.12, totalInkLimit: 3.0 };
/** Preferences ▸ Transparency & Gamut ▸ Gamut Warning: the colour painted over
 *  out-of-gamut pixels and how strongly it covers them. */
export interface GamutWarningPaint {
  /** 0..255 sRGB; out-of-range channels are clamped (this is a user setting). */
  color: readonly [number, number, number];
  /** 0..1 coverage; 1 replaces the pixel, below 1 blends over it. */
  opacity: number;
}

/** Photoshop's factory default: medium gray at 100%. */
export const DEFAULT_GAMUT_WARNING: GamutWarningPaint = { color: [128, 128, 128], opacity: 1 };
const PRINT_PROOF_MODES = new Set<ProofMode>(["cmyk", "cyan", "magenta", "yellow", "black", "cmy"]);
// Soft-proof display options approximate Photoshop's paper/ink preview without
// touching document pixels: paper lowers the white point, black ink raises the
// printable black point, and the proofed tone is remapped between those anchors.
const PAPER_WHITE: [number, number, number] = [0.955, 0.945, 0.91];
const BLACK_INK_FLOOR: [number, number, number] = [0.04, 0.038, 0.034];

function dotGain(ink: number, gain: number): number {
  return ink + gain * ink * (1 - ink);
}

// sRGB 0..1 → CMYK 0..1 with simple GCR (K = 1 − max(r,g,b)).
function toCmyk(r: number, g: number, b: number): [number, number, number, number] {
  const k = 1 - Math.max(r, g, b);
  if (k >= 1) return [0, 0, 0, 1];
  const ik = 1 / (1 - k);
  return [(1 - r - k) * ik, (1 - g - k) * ik, (1 - b - k) * ik, k];
}

export function isCmykGamutWarning(
  r8: number,
  g8: number,
  b8: number,
  press: PressBehaviour = SWOP,
): boolean {
  const r = r8 / 255, g = g8 / 255, b = b8 / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max - min;
  const [c0, m0, y0, k0] = toCmyk(r, g, b);
  const gain = press.dotGain;
  const totalInk = dotGain(c0, gain) + dotGain(m0, gain) + dotGain(y0, gain) + dotGain(k0, gain);
  if (totalInk > press.totalInkLimit) return true;
  // Bright, highly saturated RGB colours are the common practical warning case
  // in CMYK previewing. Neutral ramps and low-chroma photographs stay unmarked.
  return max > 0.72 && chroma > 0.68;
}

/** The display-only pixel to show for an out-of-gamut sample. `src` is the pixel
 *  being covered — required only when the paint is translucent; omit it (as an
 *  opaque caller may) and the warning colour is returned as-is. */
export function gamutWarningPixel(
  src?: readonly [number, number, number],
  paint: GamutWarningPaint = DEFAULT_GAMUT_WARNING,
): [number, number, number] {
  const c = paint.color.map(byte) as [number, number, number];
  // A non-finite opacity falls back to opaque: a warning you can't see is worse
  // than one that over-covers.
  const a = Number.isFinite(paint.opacity) ? clamp01(paint.opacity) : 1;
  if (!src || a >= 1) return c;
  return [
    Math.round(c[0] * a + src[0] * (1 - a)),
    Math.round(c[1] * a + src[1] * (1 - a)),
    Math.round(c[2] * a + src[2] * (1 - a)),
  ];
}

/** Sanitize a paint that crossed a trust boundary (persisted preferences, a
 *  host command): anything malformed falls back to the factory default rather
 *  than painting garbage — or nothing — over out-of-gamut pixels. */
export function normalizeGamutWarningPaint(value: unknown): GamutWarningPaint {
  const paint = value as Partial<GamutWarningPaint> | null | undefined;
  const c = paint?.color;
  const color = Array.isArray(c) && c.length >= 3 && c.slice(0, 3).every((v) => typeof v === "number" && Number.isFinite(v))
    ? ([byte(c[0]), byte(c[1]), byte(c[2])] as [number, number, number])
    : DEFAULT_GAMUT_WARNING.color;
  const o = paint?.opacity;
  return { color, opacity: typeof o === "number" && Number.isFinite(o) ? clamp01(o) : DEFAULT_GAMUT_WARNING.opacity };
}

// Dichromat simulation matrices (Machado, Oliveira & Fernandes 2009, severity
// 1.0), applied directly on sRGB — the common, observably-correct approximation.
const PROTAN = [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998];
const DEUTAN = [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881];

function matrix(m: number[], r: number, g: number, b: number): [number, number, number] {
  return [
    m[0] * r + m[1] * g + m[2] * b,
    m[3] * r + m[4] * g + m[5] * b,
    m[6] * r + m[7] * g + m[8] * b,
  ];
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const byte = (v: number) => (v < 0 || Number.isNaN(v) ? 0 : v > 255 ? 255 : Math.round(v));
const srgbToLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const linearToSrgb = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
const ACESCG = [0.6131, 0.3395, 0.0474, 0.0702, 0.9164, 0.0135, 0.0206, 0.1096, 0.8698];
const ACES2065 = [0.4396, 0.3830, 0.1774, 0.0898, 0.8134, 0.0968, 0.0175, 0.1115, 0.8710];

function acesTone(v: number): number {
  return (v * (2.51 * v + 0.03)) / (v * (2.43 * v + 0.59) + 0.14);
}

function acesProof(m: number[], r: number, g: number, b: number, exposure: number): [number, number, number] {
  const [lr, lg, lb] = [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
  const [wr, wg, wb] = matrix(m, lr, lg, lb).map((v) => Math.max(0, v * exposure)) as [number, number, number];
  return [linearToSrgb(acesTone(wr)), linearToSrgb(acesTone(wg)), linearToSrgb(acesTone(wb))];
}

function hdrProof(r: number, g: number, b: number, kind: "pq" | "hlg"): [number, number, number] {
  const [lr, lg, lb] = [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
  const luma = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
  const headroom = kind === "pq" ? 1.65 : 1.35;
  const knee = kind === "pq" ? 0.52 : 0.42;
  const lift = luma <= knee ? 1 : 1 + (headroom - 1) * Math.pow((luma - knee) / (1 - knee), kind === "pq" ? 0.65 : 0.5);
  const compress = (v: number) => acesTone(v * lift);
  return [linearToSrgb(compress(lr)), linearToSrgb(compress(lg)), linearToSrgb(compress(lb))];
}

function applyPrintSimulation(
  mode: ProofMode,
  r: number,
  g: number,
  b: number,
  options?: ProofOptions,
): [number, number, number] {
  if (!PRINT_PROOF_MODES.has(mode) || (!options?.simulatePaperColor && !options?.simulateBlackInk)) {
    return [r, g, b];
  }
  const white: [number, number, number] = options.simulatePaperColor ? PAPER_WHITE : [1, 1, 1];
  const black: [number, number, number] = options.simulateBlackInk ? BLACK_INK_FLOOR : [0, 0, 0];
  return [
    black[0] + r * (white[0] - black[0]),
    black[1] + g * (white[1] - black[1]),
    black[2] + b * (white[2] - black[2]),
  ];
}

/** Per-channel affine remap (`out = v·scale + offset`, 0..255) applied to ICC
 *  proof LUT samples on the blit path. */
export interface IccProofSimulation {
  scale: [number, number, number];
  offset: [number, number, number];
}

/** ICC proof branch (a real press/device profile is baked into the LUT): the
 *  LUT maps doc → proof → sRGB relative-colorimetrically with no display-side
 *  BPC, so the proof's media black arrives at its true (lighter) rendition and
 *  media white at display white. Photoshop's display options become a
 *  per-channel affine remap of the LUT sample:
 *    · neither box        → stretch [ink black … white] to [0 … 255] — the
 *      proof→monitor black mapping Photoshop always applies unless simulating;
 *    · Simulate Black Ink → identity (show the true, lighter press black);
 *    · Simulate Paper Color → scale towards the paper tint (absolute-
 *      colorimetric approximation; implies Black Ink, as in Photoshop).
 *  `inkBlack` is the LUT's own rendition of proof black (`lut[0..2]`), so the
 *  black anchor is profile-derived — unlike the profile-free heuristics above.
 *  Returns null when the remap is an identity. */
export function iccProofSimulationMap(
  inkBlack: readonly [number, number, number],
  options?: ProofOptions,
): IccProofSimulation | null {
  if (options?.simulatePaperColor) {
    // ponytail: fixed paper tint — the true media white (wtpt) lives in the
    // proof profile bytes the display path never sees; when the store hands
    // the profile (or an absolute-intent LUT) down, derive the tint from it.
    return { scale: [PAPER_WHITE[0], PAPER_WHITE[1], PAPER_WHITE[2]], offset: [0, 0, 0] };
  }
  if (options?.simulateBlackInk) return null;
  const scale = inkBlack.map((ib) => 255 / Math.max(1, 255 - ib)) as [number, number, number];
  if (scale.every((s) => s === 1)) return null;
  return { scale, offset: inkBlack.map((ib, c) => -ib * scale[c]) as [number, number, number] };
}

// Map one sRGB pixel (0..255 ints) through the proof; returns 0..255 ints.
export function proofPixel(
  mode: ProofMode,
  r8: number,
  g8: number,
  b8: number,
  options?: ProofOptions,
): [number, number, number] {
  const r = r8 / 255, g = g8 / 255, b = b8 / 255;
  let or = r, og = g, ob = b;
  switch (mode) {
    case "cmyk": {
      const press = options?.press ?? SWOP;
      const gain = press.dotGain;
      const tac = press.totalInkLimit;
      let [c, m, y, k] = toCmyk(r, g, b);
      c = dotGain(c, gain); m = dotGain(m, gain); y = dotGain(y, gain); k = dotGain(k, gain);
      const total = c + m + y + k;
      if (total > tac) { const s = (tac - k) / (c + m + y || 1); c *= s; m *= s; y *= s; }
      const ik = 1 - k;
      or = (1 - c) * ik; og = (1 - m) * ik; ob = (1 - y) * ik;
      break;
    }
    case "cyan": { const [c] = toCmyk(r, g, b); or = og = ob = 1 - c; break; }
    case "magenta": { const [, m] = toCmyk(r, g, b); or = og = ob = 1 - m; break; }
    case "yellow": { const [, , y] = toCmyk(r, g, b); or = og = ob = 1 - y; break; }
    case "black": { const [, , , k] = toCmyk(r, g, b); or = og = ob = 1 - k; break; }
    case "cmy": { const [c, m, y] = toCmyk(r, g, b); or = 1 - c; og = 1 - m; ob = 1 - y; break; }
    case "acescg": [or, og, ob] = acesProof(ACESCG, r, g, b, 1.15); break;
    case "aces2065": [or, og, ob] = acesProof(ACES2065, r, g, b, 1.25); break;
    case "hdr-pq": [or, og, ob] = hdrProof(r, g, b, "pq"); break;
    case "hdr-hlg": [or, og, ob] = hdrProof(r, g, b, "hlg"); break;
    case "gamma18": {
      // sRGB content shown on a legacy γ1.8 display: midtones lighten.
      const e = 1.8 / 2.2;
      or = Math.pow(r, e); og = Math.pow(g, e); ob = Math.pow(b, e);
      break;
    }
    case "srgb":
    case "monitor": break; // identity in Vision's sRGB, host-colour-managed canvas
    case "protanopia": [or, og, ob] = matrix(PROTAN, r, g, b); break;
    case "deuteranopia": [or, og, ob] = matrix(DEUTAN, r, g, b); break;
  }
  [or, og, ob] = applyPrintSimulation(mode, or, og, ob, options);
  return [Math.round(clamp01(or) * 255), Math.round(clamp01(og) * 255), Math.round(clamp01(ob) * 255)];
}
