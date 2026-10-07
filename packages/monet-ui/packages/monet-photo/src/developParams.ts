// developParams — serialize a DevelopRecipeV2 to the legacy Float32Array
// compatibility API. Normal Galerie and Vision paths send canonical JSON; this
// positional converter remains pinned for old callers and project migration.
//
// The 1086-float prefix mirrors Vision's Camera-Raw layout (apps/vision/src/
// state/cameraRaw.ts) — this shared serializer is what lets Vision and Galerie
// drive the same develop engine from the canonical recipe (§3.2). Float buffers
// are derived caches; the recipe stays the source of truth.
//
//   [0] version  [1] proxyScale
//   [2..15]  Basic: temp,tint,exposure,contrast,highlights,shadows,whites,
//            blacks,texture,clarity,dehaze,vibrance,saturation
//   [15..20] Detail: sharpenAmount,sharpenRadius,nrLuminance,nrColor,nrLumDetail
//   [20..23] grain: amount,roughness,size
//   [23..25] vignette: amount,midpoint
//   [25]     curveEnabled
//   [26..1050]  master[256], r[256], g[256], b[256] point-curve LUTs
//   [1050..1053] Optics: distortion, aberration(continuous), defringe
//   [1053..1077] Color Mixer: hue[8], saturation[8], luminance[8]
//   [1077..1083] Color Grading: (hue,sat) for shadows, midtones, highlights
//   [1083..1086] Transform: vertical, horizontal, rotate
//   (Transform's aspect/scale/offsets/constrainCrop ride the v4 advanced tail,
//   and the Detail sub-sliders, lens Vignetting, Defringe hue windows + green
//   amount and the Upright mode ride the v5 extras block — the 1086 prefix is
//   frozen.)

import {
  MAX_HEAL_SPOTS, MAX_ENGINE_MASKS, PROFILE_DIGEST_RE, createDefaultRecipe, isAsShotKelvin, normalizeProfileSource,
  type CropPanel, type DevelopRecipeV2, type EngineMask, type EngineMaskAdjustments,
  type EngineMaskKind, type ToneCurvePanel, type UprightMode,
} from "./developRecipe";
import { buildLut, masterToneLut, type CurvePointLike } from "./toneCurve";
import { lensProfileWords } from "./lensCorrection";
// The 1086-prefix offsets + advanced-tail magic are the shared develop ABI
// layout — defined once in ./abiLayout so this codec and Vision's cameraRaw
// codec can never drift out of alignment (docs/plans/10 Phase 5).
import { CURVE_BASE, CURVE_END, OPTICS_END, HSL_END, GRADE_END, DEVELOP_PARAMS_LEN, DEV_ADVANCED_MAGIC } from "./abiLayout";

export const PARAM_VERSION = 1;

// Advanced tail (engine `parse_develop_advanced`): appended only when a feature
// beyond the 1086 global prefix is active, so a neutral recipe stays 1086 and
// renders byte-identically. Camera Calibration rides the legacy (v1) tail:
// profile block (offsets 1088..1096) then zeroed crop/denoise/heal/mask counts —
// Galerie applies crop + masks in TS, and a non-zero count would double-render.
// Point Color needs the v3 tail: the v1 block, then a valid (renderer-ignored)
// curve-source, then the socket block.
const DEV_ADVANCED_LEGACY = 1;
const DEV_ADVANCED_V3 = 3;
// V4 = the v3 layout plus a trailing 5-float Transform block: [aspect, scale,
// xOffset, yOffset, constrainCrop]. Emitted only when one of those is
// non-neutral, so every existing recipe keeps its exact bytes/length.
const DEV_ADVANCED_V4 = 4;
const DEV_TRANSFORM_BLOCK_LEN = 5;
const NEUTRAL_TRANSFORM_BLOCK = [0, 1, 0, 0, 0];
// V5 = the v4 layout plus a trailing 12-float extras block (#444): [sharpenDetail,
// sharpenMasking, nrLuminanceContrast, nrColorDetail, nrColorSmoothness,
// vignettingAmount, purpleHueLo, purpleHueHi, defringeGreenAmount, greenHueLo,
// greenHueHi, upright code]. Emitted only when one is off its default, so every
// existing recipe keeps its exact bytes/length.
const DEV_ADVANCED_V5 = 5;
const DEV_EXTRAS_LEN = 12;
// V6 = the v5 layout plus the 9-float profile identity (#446): which DNG camera
// profile an embedded (4) / custom (5) profile renders through, as its digest's
// eight 16-bit words, then the image's as-shot kelvin (0 = unknown). Emitted
// only for those two ids with a digest, so every other recipe keeps its exact
// bytes/length.
const DEV_ADVANCED_V6 = 6;
const DEV_ADVANCED_V7 = 7;
const DEV_ADVANCED_V8 = 8;

/** Upright mode → engine code (v5 extras). The solved correction itself rides the
 *  keystone floats [1083..1085]; the tail only carries which mode produced it. */
export const UPRIGHT_CODES: Record<UprightMode, number> = {
  off: 0, auto: 1, level: 2, vertical: 3, full: 4, guided: 5,
};

/** Clamp into the engine parser's range; non-finite falls back to `fallback`. */
const bounded = (v: number | undefined, lo: number, hi: number, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

/** The v4 transform block [aspect, scale, xOffset, yOffset, constrainCrop], or
 *  null when neutral. Pre-clamped to the engine parser's accepted ranges — an
 *  out-of-range value would atomically reject the WHOLE tail (calibration,
 *  heals…), which must never be reachable from the UI. The `??` fallbacks keep
 *  un-normalized recipes that predate these fields neutral. */
function transformBlock(t: DevelopRecipeV2["transform"]): number[] | null {
  const aspect = Math.min(1, Math.max(-1, t.aspect ?? 0));
  const scale = Math.min(4, Math.max(0.25, t.scale ?? 1));
  const x = Math.min(1, Math.max(-1, t.xOffset ?? 0));
  const y = Math.min(1, Math.max(-1, t.yOffset ?? 0));
  // Constrain Crop only matters when some geometry is actually warping.
  const constrain =
    t.constrainCrop === true &&
    (t.vertical !== 0 || t.horizontal !== 0 || t.rotate !== 0 || aspect !== 0 || scale !== 1);
  if (aspect === 0 && scale === 1 && x === 0 && y === 0 && !constrain) return null;
  return [aspect, scale, x, y, constrain ? 1 : 0];
}

/** The v5 extras block, or null when every value is at its default. Same
 *  pre-clamp rule as the transform block: detail 0..100, vignetting -1..1, green
 *  amount 0..1, hue windows 0..100 and ordered, unknown Upright modes → Off. */
function developExtras(r: DevelopRecipeV2): number[] | null {
  const values = extrasOf(r);
  return values.every((v, i) => v === NEUTRAL_EXTRAS[i]) ? null : values;
}

function extrasOf(r: DevelopRecipeV2): number[] {
  const d = r.detail, o = r.optics;
  const pct = (v: number | undefined, fallback: number) => bounded(v, 0, 100, fallback);
  const window = (pair: readonly number[] | undefined, fallback: readonly number[]) => {
    const lo = pct(pair?.[0], fallback[0]), hi = pct(pair?.[1], fallback[1]);
    return lo <= hi ? [lo, hi] : [hi, lo];
  };
  const upright = UPRIGHT_CODES[r.transform.upright];
  return [
    pct(d.sharpenDetail, DEFAULTS.detail.sharpenDetail),
    pct(d.sharpenMasking, DEFAULTS.detail.sharpenMasking),
    pct(d.nrLuminanceContrast, DEFAULTS.detail.nrLuminanceContrast),
    pct(d.nrColorDetail, DEFAULTS.detail.nrColorDetail),
    pct(d.nrColorSmoothness, DEFAULTS.detail.nrColorSmoothness),
    bounded(o.vignettingAmount, -1, 1, DEFAULTS.optics.vignettingAmount),
    ...window(o.defringePurpleHue, DEFAULTS.optics.defringePurpleHue),
    bounded(o.defringeGreenAmount, 0, 1, DEFAULTS.optics.defringeGreenAmount),
    ...window(o.defringeGreenHue, DEFAULTS.optics.defringeGreenHue),
    typeof upright === "number" ? upright : 0,
  ];
}

const DEFAULTS = createDefaultRecipe();
const NEUTRAL_EXTRAS = extrasOf(DEFAULTS);
/** 1086 prefix + 27-float legacy tail (magic … mask_count). */
export const DEVELOP_ADVANCED_PARAMS_LEN = DEVELOP_PARAMS_LEN + 27; // 1113
/** v3 adds a 24-float identity curve-source (4 parametric + 4×[2,0,0,1,1]). */
const DEV_V3_CURVE_SOURCE_LEN = 24;
/** Engine cap on Point Color sockets (mirrors DEV_MAX_POINT_COLORS). */
const DEV_MAX_POINT_COLORS = 8;

/** Profile id → engine profile code (advanced tail p[1088]). Mirrors Vision's
 *  map (apps/vision/src/state/cameraRaw.ts) so Galerie and Vision drive the
 *  engine's develop_profile_calibration identically. */
export const PROFILE_CODES: Record<string, number> = {
  "camera-default": 0,
  "adobe-color": 1,
  "camera-neutral": 2,
  monochrome: 3,
  embedded: 4,
  custom: 5,
};

/** The v6 profile identity — the digest's eight 16-bit words, then the
 *  as-shot kelvin (0 = unknown) — for an embedded/custom profile that names
 *  a digest, else null. */
export function profileIdentityWords(profile: DevelopRecipeV2["profile"]): number[] | null {
  const code = PROFILE_CODES[profile.id];
  if ((code !== 4 && code !== 5) || !profile.digest || !PROFILE_DIGEST_RE.test(profile.digest)) return null;
  const words = Array.from({ length: 8 }, (_, i) => parseInt(profile.digest!.slice(i * 4, i * 4 + 4), 16));
  const source = normalizeProfileSource(profile.sourceCamera);
  return [...words, isAsShotKelvin(profile.asShotKelvin) ? profile.asShotKelvin : 0,
    ...(source ? [...source.cameraToXyz, ...source.whiteBalance] : [])];
}

/** Mask kind → engine code + the 16 local-adjustment sliders in serialized
 *  order. Both mirror Vision's cameraRaw codec verbatim so the visionV2 tail's
 *  mask records are byte-identical to Vision's appendAdvancedParams. */
const ENGINE_MASK_KIND_CODES: Record<EngineMaskKind, number> = {
  brush: 0,
  "linear-gradient": 1,
  "radial-gradient": 2,
  "luminance-range": 3,
  "color-range": 4,
  subject: 5,
  sky: 6,
  outline: 7,
  "bidirectional-gradient": 8,
};
const ENGINE_MASK_ADJ_KEYS = [
  "temp", "tint", "exposure", "contrast", "highlights", "shadows", "whites", "blacks",
  "texture", "clarity", "dehaze", "saturation", "sharpness", "noiseReduction", "moire", "defringe",
] as const satisfies readonly (keyof EngineMaskAdjustments)[];

/** Emit Vision's mask block: mask_count then one record per mask (9-float
 *  header, 16 adjustments, points·3, colors·3), matching appendAdvancedParams. */
function pushEngineMaskBlock(tail: number[], engineMasks: EngineMask[] | undefined): void {
  const masks = (engineMasks ?? []).slice(0, MAX_ENGINE_MASKS);
  tail.push(masks.length);
  for (const mask of masks) {
    const colors = mask.colorSamples ?? [];
    tail.push(
      ENGINE_MASK_KIND_CODES[mask.kind], mask.enabled ? 1 : 0, mask.inverted ? 1 : 0,
      mask.opacity, mask.feather, mask.range?.[0] ?? 0, mask.range?.[1] ?? 1,
      mask.points.length, colors.length,
    );
    for (const key of ENGINE_MASK_ADJ_KEYS) tail.push(mask.adjustments[key]);
    for (const pt of mask.points) tail.push(pt.x, pt.y, pt.pressure);
    for (const c of colors) tail.push(c[0], c[1], c[2]);
  }
}

/** Neutral = camera-default (engine code 0) at full amount — matches Vision's
 *  hasEngineAdvancedRecipe gate and keeps the default recipe at 1086 floats. */
function profileIsNeutral(pr: DevelopRecipeV2["profile"]): boolean {
  return pr.id === "camera-default" && pr.amount === 1;
}

function calibrationIsNeutral(c: DevelopRecipeV2["calibration"]): boolean {
  return (
    c.shadowTint === 0 &&
    c.redHue === 0 &&
    c.redSat === 0 &&
    c.greenHue === 0 &&
    c.greenSat === 0 &&
    c.blueHue === 0 &&
    c.blueSat === 0
  );
}

function writeLut(p: Float32Array, base: number, points: readonly CurvePointLike[]): void {
  const lut = buildLut(points);
  for (let i = 0; i < 256; i++) p[base + i] = lut[i];
}

function writeBand(p: Float32Array, base: number, band: readonly number[]): void {
  for (let i = 0; i < 8; i++) p[base + i] = band[i] ?? 0;
}

/**
 * Build the flat engine params from a DevelopRecipeV2. `proxyScale` fills header
 * slot [1] only; recipe values are written verbatim (never pre-scaled).
 */
/** Advanced-tail format selector.
 *  - "auto" (default/absent): today's Galerie tail — legacy(v1)/v3, crop zeroed.
 *    Byte-for-byte unchanged.
 *  - "visionV2": emit Vision's appendAdvancedParams v2 tail (version 2, real crop
 *    dims from crop.rect, post-heal curve-authoring block) so the Vision→V2
 *    migration conforms past the heal block. Emits Vision's engine masks
 *    (recipe.engineMasks) and Point Color sockets; mask_count is 0 when there
 *    are no engineMasks. */
export interface RecipeToParamsOptions {
  tailFormat?: "auto" | "visionV2";
}

/** LR panel switches (recipe.enabled): a disabled panel contributes NOTHING, so
 *  substitute its neutral default before serializing — one enforcement point for
 *  every tail format. toneCurve is the exception: its authored values stay and
 *  it rides the engine's dedicated enable float (p[25]), mirroring Vision's
 *  curve.enabled semantics (cameraRawToV2 only ever varies that one flag). */
function applyPanelEnables(recipe: DevelopRecipeV2): DevelopRecipeV2 {
  const en = recipe.enabled;
  if (
    en.basic && en.colorMixer && en.pointColor && en.colorGrading && en.detail &&
    en.optics && en.transform && en.effects && en.calibration
  ) {
    return recipe; // common case: all on — zero allocation
  }
  const d = createDefaultRecipe();
  return {
    ...recipe,
    basic: en.basic ? recipe.basic : d.basic,
    colorMixer: en.colorMixer ? recipe.colorMixer : d.colorMixer,
    pointColor: en.pointColor ? recipe.pointColor : d.pointColor,
    colorGrading: en.colorGrading ? recipe.colorGrading : d.colorGrading,
    detail: en.detail ? recipe.detail : d.detail,
    optics: en.optics ? recipe.optics : d.optics,
    transform: en.transform ? recipe.transform : d.transform,
    effects: en.effects ? recipe.effects : d.effects,
    calibration: en.calibration ? recipe.calibration : d.calibration,
  };
}

export function recipeToParams(recipe: DevelopRecipeV2, proxyScale = 1, opts?: RecipeToParamsOptions): Float32Array {
  recipe = applyPanelEnables(recipe);
  const p = new Float32Array(DEVELOP_PARAMS_LEN);
  p[0] = PARAM_VERSION;
  p[1] = proxyScale;

  const b = recipe.basic;
  p[2] = b.temp;
  p[3] = b.tint;
  p[4] = b.exposure;
  p[5] = b.contrast;
  p[6] = b.highlights;
  p[7] = b.shadows;
  p[8] = b.whites;
  p[9] = b.blacks;
  p[10] = b.texture;
  p[11] = b.clarity;
  p[12] = b.dehaze;
  p[13] = b.vibrance;
  p[14] = b.saturation;

  const d = recipe.detail;
  p[15] = d.sharpenAmount;
  p[16] = d.sharpenRadius;
  p[17] = d.nrLuminance;
  p[18] = d.nrColor;
  p[19] = d.nrLuminanceDetail;

  const e = recipe.effects;
  p[20] = e.grainAmount;
  p[21] = e.grainRoughness;
  p[22] = e.grainSize;
  p[23] = e.vignetteAmount;
  p[24] = e.vignetteMidpoint;

  p[25] = recipe.enabled.toneCurve ? 1 : 0;
  const compiled = recipe.toneCurve.compiledLuts;
  if (compiled) {
    // Vision DECOUPLES the render-prefix LUTs from the authoring points (its stored
    // master/r/g/b are what render). Write them verbatim, mirroring Vision's old
    // cameraRaw post-step (`lut[i] ?? i`). PREFIX ONLY — this does NOT touch the
    // advanced-tail gate below, so a compiledLuts recipe with default points stays
    // 1086 floats.
    for (let i = 0; i < 256; i++) {
      p[CURVE_BASE + i] = compiled.master[i] ?? i;
      p[CURVE_BASE + 256 + i] = compiled.r[i] ?? i;
      p[CURVE_BASE + 512 + i] = compiled.g[i] ?? i;
      p[CURVE_BASE + 768 + i] = compiled.b[i] ?? i;
    }
  } else {
    // Master curve = the point curve with the parametric regions composed after it.
    // The split points must reach the render, not just the panel preview —
    // without them the parametric regions compose at the hardcoded quarter
    // knots and dragging a split handle changes nothing in the image.
    const master = masterToneLut(
      recipe.toneCurve.point,
      recipe.toneCurve.parametric,
      recipe.toneCurve.parametricSplits,
    );
    for (let i = 0; i < 256; i++) p[CURVE_BASE + i] = master[i];
    writeLut(p, CURVE_BASE + 256, recipe.toneCurve.red);
    writeLut(p, CURVE_BASE + 512, recipe.toneCurve.green);
    writeLut(p, CURVE_BASE + 768, recipe.toneCurve.blue);
  }

  const o = recipe.optics;
  p[CURVE_END] = o.distortionAmount;
  // Continuous CA (engine p[1051] is continuous). `aberration` is canonical;
  // fall back to the legacy boolean for un-normalized recipes that predate it.
  const abr = (o as { aberration?: number }).aberration;
  const legacyCA = (o as { removeChromaticAberration?: boolean }).removeChromaticAberration;
  p[CURVE_END + 1] = abr ?? (legacyCA ? 1 : 0);
  p[CURVE_END + 2] = o.defringePurpleAmount;

  const cm = recipe.colorMixer;
  writeBand(p, OPTICS_END, cm.hue);
  writeBand(p, OPTICS_END + 8, cm.saturation);
  writeBand(p, OPTICS_END + 16, cm.luminance);

  const g = recipe.colorGrading;
  p[HSL_END] = g.shadows.hue;
  p[HSL_END + 1] = g.shadows.sat;
  p[HSL_END + 2] = g.midtones.hue;
  p[HSL_END + 3] = g.midtones.sat;
  p[HSL_END + 4] = g.highlights.hue;
  p[HSL_END + 5] = g.highlights.sat;

  const t = recipe.transform;
  p[GRADE_END] = t.vertical;
  p[GRADE_END + 1] = t.horizontal;
  p[GRADE_END + 2] = t.rotate;

  if (opts?.tailFormat === "visionV2") return appendVisionV2Tail(p, recipe);

  const cal = recipe.calibration;
  // Same cap story as the heals below: a socket count above DEV_MAX_POINT_COLORS
  // rejects the WHOLE tail atomically, and this path also serves recipes that
  // never went through normalizeRecipe (galerie's preview JSON), so clamp
  // here too — matching appendVisionV2Tail (#223).
  const samples = recipe.pointColor.samples.slice(0, DEV_MAX_POINT_COLORS);
  // Engine cap: DEV_MAX_HEALS = 64 — a longer list would reject the whole tail
  // atomically, so clamp here (the UI refuses placement beyond the cap anyway).
  const heals = (recipe.heal?.spots ?? []).slice(0, MAX_HEAL_SPOTS);
  const xf = transformBlock(t);
  const extras = developExtras(recipe);
  const identity = profileIdentityWords(recipe.profile);
  const lens = lensProfileWords(recipe.optics);
  if (
    profileIsNeutral(recipe.profile) &&
    calibrationIsNeutral(cal) &&
    samples.length === 0 &&
    heals.length === 0 &&
    !xf &&
    !extras && !lens
  ) {
    return p;
  }

  // Append the advanced tail (parse_develop_advanced). Calibration/heals → v1
  // tail; Point Color → v3 (curve-source + socket block). Engine-verified offsets:
  //   [1086] magic  [1087] version  [1088] profile code 0  [1089] amount 0
  //   [1090] shadowTint  [1091..1096] red/green/blue primary (hue,sat)
  //   [1097..1110] crop + denoise/enhance (disabled)  [1111] heal_count
  //   [1112..] heals (8 floats each), then mask_count (0) — everything after
  //   the heal block floats right by 8·healCount.
  // v4 (transform extras) is the v3 layout + the transform block, so it always
  // carries the curve-source + socket block too (socket count may be 0). v5 is
  // the v4 layout + the extras block (its transform block may be neutral).
  const useV6 = identity !== null;
  const useV5 = extras !== null || useV6 || lens !== null;
  const useV4 = xf !== null || useV5;
  const useV3 = useV4 || samples.length > 0;
  const base = DEVELOP_PARAMS_LEN; // 1086
  const healLen = heals.length * 8;
  const length = useV3
    ? base + 27 + healLen + DEV_V3_CURVE_SOURCE_LEN + 1 + samples.length * 7 +
      (useV4 ? DEV_TRANSFORM_BLOCK_LEN : 0) + (useV5 ? DEV_EXTRAS_LEN : 0) + (identity?.length ?? 0) + (lens ? 1 + lens.length : 0)
    : DEVELOP_ADVANCED_PARAMS_LEN + healLen;
  const out = new Float32Array(length);
  out.set(p);
  out[base] = DEV_ADVANCED_MAGIC; // 1086
  out[base + 1] = lens ? DEV_ADVANCED_V8 : (identity?.length ?? 0) > 9 ? DEV_ADVANCED_V7 : useV6 ? DEV_ADVANCED_V6 : useV5 ? DEV_ADVANCED_V5 : useV4 ? DEV_ADVANCED_V4 : useV3 ? DEV_ADVANCED_V3 : DEV_ADVANCED_LEGACY; // 1087
  // Profile block (shared by v1 + v3). Unknown ids fall back to code 0
  // (camera-default) so a stray profile renders neutrally, not with a wrong LUT.
  out[base + 2] = PROFILE_CODES[recipe.profile.id] ?? 0; // [1088] profile code
  out[base + 3] = recipe.profile.amount; // [1089] profile amount
  out[base + 4] = cal.shadowTint; // 1090
  out[base + 5] = cal.redHue; // 1091
  out[base + 6] = cal.redSat; // 1092
  out[base + 7] = cal.greenHue; // 1093
  out[base + 8] = cal.greenSat; // 1094
  out[base + 9] = cal.blueHue; // 1095
  out[base + 10] = cal.blueSat; // 1096
  // [base+11..base+24] crop/denoise/enhance stay 0.
  out[base + 25] = heals.length; // [1111] heal_count
  {
    // [1112..] one 8-float record per spot, engine order. mask_count is the
    // next float after the block and stays 0 via zero-init.
    let c = base + 26;
    for (const s of heals) {
      out[c] = s.mode === "clone" ? 1 : 0;
      out[c + 1] = s.x;
      out[c + 2] = s.y;
      out[c + 3] = s.sourceX;
      out[c + 4] = s.sourceY;
      out[c + 5] = s.radius;
      out[c + 6] = s.feather;
      out[c + 7] = s.opacity;
      c += 8;
    }
  }
  if (useV3) {
    // Curve-source (v2/v3): 4 parametric (0) + 4 identity channels [2, 0,0,1,1].
    // The renderer validates but ignores it (it uses the prefix LUTs) and Galerie
    // never reads flat params back, so an identity source is correct + always valid.
    let c = base + 27 + healLen; // parametric [c..c+4] stay 0
    c += 4;
    for (let ch = 0; ch < 4; ch++) {
      out[c] = 2; // point count
      out[c + 3] = 1; // second point x = 1  (first point is (0,0))
      out[c + 4] = 1; // second point y = 1
      c += 5;
    }
    out[c] = samples.length; // socket count (0..8)
    c += 1;
    // Socket order matches the engine: [refHue(0..360), refSat, refLum, hue, sat,
    // lum, range]. Galerie's srcHue/srcSat/srcLum ARE the engine reference HSL.
    for (const s of samples) {
      out[c] = s.srcHue;
      out[c + 1] = s.srcSat;
      out[c + 2] = s.srcLum;
      out[c + 3] = s.hue;
      out[c + 4] = s.sat;
      out[c + 5] = s.lum;
      out[c + 6] = s.range;
      c += 7;
    }
    if (useV4) {
      // v4 transform block — engine geometry_transform_buf order — then the v5
      // extras in the engine's DevelopExtras order, then the v6 identity.
      out.set(xf ?? NEUTRAL_TRANSFORM_BLOCK, c);
      if (useV5) out.set(extras ?? NEUTRAL_EXTRAS, c + DEV_TRANSFORM_BLOCK_LEN);
      const end = c + DEV_TRANSFORM_BLOCK_LEN + DEV_EXTRAS_LEN;
      if (lens) out.set([identity?.length ?? 0, ...(identity ?? []), ...lens], end);
      else if (identity) out.set(identity, end);
    }
  }
  return out;
}

/** A crop is active when the rect isn't the whole frame or a straighten angle is
 *  set. V2 has no explicit crop.enabled/flip flags (Vision does), so a Vision
 *  recipe that enabled the crop tool on a full-frame rect can't round-trip
 *  byte-exact — a known V2 schema limitation shared with the flip flags below.
 *  Exported so the XMP dialect gates its crs:Crop* block on the same test. */
export function cropIsActive(crop: CropPanel): boolean {
  const { top, left, bottom, right } = crop.rect;
  return left !== 0 || top !== 0 || right !== 1 || bottom !== 1 || crop.angle !== 0;
}

/** Mirrors Vision's hasCustomCurveAuthoring: any non-zero parametric region or a
 *  channel that isn't the identity [{0,0},{1,1}]. */
function toneCurveIsAuthored(tc: ToneCurvePanel): boolean {
  const pm = tc.parametric;
  if (pm.highlights !== 0 || pm.lights !== 0 || pm.darks !== 0 || pm.shadows !== 0) return true;
  return [tc.point, tc.red, tc.green, tc.blue].some(
    (ch) => ch.length !== 2 || ch[0].x !== 0 || ch[0].y !== 0 || ch[1].x !== 1 || ch[1].y !== 1,
  );
}

/**
 * Emit the SAME advanced tail Vision's cameraRaw.appendAdvancedParams writes.
 * For a point-color-free recipe that's the v2 format: version 2, real crop dims
 * from crop.rect, and — after the heal block + mask_count — a curve-authoring
 * block (4 parametric + 4 channels, each [point-count, x,y…] in order
 * point/red/green/blue). When recipe.pointColor.samples is non-empty Vision bumps
 * the SAME tail to version 3 and appends a socket block after the curve authoring
 * ([count, then refHue,refSat,refLum,hue,sat,lum,range per socket]); the crop and
 * curve-authoring regions stay the real authored values (NOT identity). This lets
 * the Vision→V2 migration conform over the full length. Vision's engine masks
 * (recipe.engineMasks) are emitted verbatim between the heal block and the curve
 * authoring — mask_count then one record per mask — so masked Vision recipes are
 * byte-identical too; mask_count stays 0 when engineMasks is absent.
 */
function appendVisionV2Tail(base: Float32Array, recipe: DevelopRecipeV2): Float32Array {
  const cal = recipe.calibration;
  const crop = recipe.crop;
  // Same 64-cap as the default tail (DEV_MAX_HEALS); Vision clamps identically.
  const heals = (recipe.heal?.spots ?? []).slice(0, MAX_HEAL_SPOTS);
  // Point Color: same 8-cap as the engine (DEV_MAX_POINT_COLORS); Vision's
  // normalize clamps to 8, so this only ever trims a hostile over-long list.
  const samples = recipe.pointColor.samples.slice(0, DEV_MAX_POINT_COLORS);
  const enh = recipe.enhance;
  const xf = transformBlock(recipe.transform);
  const extras = developExtras(recipe);
  const identity = profileIdentityWords(recipe.profile);
  const lens = lensProfileWords(recipe.optics);
  // Vision's hasEngineAdvancedRecipe gate. A neutral recipe emits no tail,
  // matching Vision's 1086-float floor. (Flips/denoiseAmount aren't gate-relevant
  // on Vision either — they only ride an already-active tail.)
  const active =
    lens !== null || xf !== null ||
    extras !== null ||
    !profileIsNeutral(recipe.profile) ||
    !calibrationIsNeutral(cal) ||
    cropIsActive(crop) ||
    heals.length > 0 ||
    samples.length > 0 ||
    (recipe.engineMasks?.length ?? 0) > 0 ||
    Boolean(enh?.denoise || enh?.rawDetails || enh?.superResolution) ||
    toneCurveIsAuthored(recipe.toneCurve);
  if (!active) return base;

  const { top, left, bottom, right } = crop.rect;
  const tail: number[] = [
    DEV_ADVANCED_MAGIC, // [1086]
    // [1087] version 2; 3 with sockets; 4 with transform extras; 5 with the v5
    // extras; 6 with a profile identity
    lens ? DEV_ADVANCED_V8 : (identity?.length ?? 0) > 9 ? DEV_ADVANCED_V7 : identity ? DEV_ADVANCED_V6 : extras ? DEV_ADVANCED_V5 : xf ? DEV_ADVANCED_V4 : samples.length > 0 ? DEV_ADVANCED_V3 : 2,
    PROFILE_CODES[recipe.profile.id] ?? 0, // [1088] profile code
    recipe.profile.amount, // [1089]
    cal.shadowTint, // [1090]
    cal.redHue, cal.redSat, cal.greenHue, cal.greenSat, cal.blueHue, cal.blueSat, // [1091..1096]
    cropIsActive(crop) ? 1 : 0, // [1097] crop enabled
    left, top, right - left, bottom - top, // [1098..1101] x, y, width, height
    crop.angle, // [1102]
    crop.constrainAspect != null ? 1 : 0, // [1103] constrainAspect flag
    crop.constrainAspect ?? 0, // [1104] aspect ratio
    crop.flipHorizontal ? 1 : 0, crop.flipVertical ? 1 : 0, // [1105/1106] flips (visionV2 superset)
    enh?.denoise ? 1 : 0, enh?.denoiseAmount ?? 0, // [1107/1108] denoise + amount
    enh?.rawDetails ? 1 : 0, enh?.superResolution ? 1 : 0, // [1109/1110] rawDetails/superRes
  ];
  tail.push(heals.length); // [1111]
  for (const s of heals) {
    tail.push(s.mode === "clone" ? 1 : 0, s.x, s.y, s.sourceX, s.sourceY, s.radius, s.feather, s.opacity);
  }
  pushEngineMaskBlock(tail, recipe.engineMasks); // mask_count + per-mask records
  const pm = recipe.toneCurve.parametric;
  tail.push(pm.highlights, pm.lights, pm.darks, pm.shadows);
  for (const ch of [recipe.toneCurve.point, recipe.toneCurve.red, recipe.toneCurve.green, recipe.toneCurve.blue]) {
    tail.push(ch.length);
    for (const pt of ch) tail.push(pt.x, pt.y);
  }
  // v3 socket block (Vision appends it after the curve authoring): count, then
  // 7 floats per socket in engine order. srcHue/srcSat/srcLum ARE the engine
  // reference HSL, matching Vision's refHue/refSat/refLum.
  // v4/v5 always carry the socket block (a zero count is valid), then the
  // transform block (neutral on a v5 tail without transform extras), then v5's
  // extras — the engine parser's order.
  if (samples.length > 0 || xf || extras || identity || lens) {
    tail.push(samples.length);
    for (const s of samples) tail.push(s.srcHue, s.srcSat, s.srcLum, s.hue, s.sat, s.lum, s.range);
  }
  if (xf || extras || identity || lens) tail.push(...(xf ?? NEUTRAL_TRANSFORM_BLOCK));
  if (extras || identity || lens) tail.push(...(extras ?? NEUTRAL_EXTRAS));
  if (lens) tail.push(identity?.length ?? 0, ...(identity ?? []), ...lens);
  else if (identity) tail.push(...identity);
  const out = new Float32Array(base.length + tail.length);
  out.set(base);
  out.set(tail, base.length);
  return out;
}
