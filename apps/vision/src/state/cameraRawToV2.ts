// Vision CameraRaw recipe → DevelopRecipeV2 (docs/plans/10 Phase 5).
//
// NOT a version upgrade: this maps Vision's CURRENT in-memory canonical recipe
// onto the shared develop recipe, and it is the load-bearing input to Vision's
// delegated serializer (the ABI golden + full unit suite depend on it byte-for-
// byte). It lives here because Vision is its only caller — monet-photo carries
// no knowledge of Vision's recipe shape.
import { normalizeLensSettings,
  createDefaultRecipe,
  whiteBalancePresetOffsets,
  MAX_ENGINE_MASKS,
  MAX_HEAL_SPOTS,
  MAX_POINT_COLOR_SAMPLES,
  WB_PRESETS,
  type CurvePoint,
  type DevelopRecipeV2,
  type EngineMask,
  type WhiteBalanceMode,
} from "@monet-ui/monet-photo";
import type { CanonicalCameraRawRecipe } from "./cameraRaw";

const cloneCurvePoints = (pts: { x: number; y: number }[]): CurvePoint[] =>
  pts.map((p) => ({ x: p.x, y: p.y }));

/** Temp/Tint round-trip through the engine's f32 params, so a preset's offsets
 *  come back a few ulps off the value `whiteBalancePresetOffsets` computes. The
 *  presets are ≥0.1 apart, so this tolerance can't confuse two of them. */
const WB_MATCH_EPSILON = 1e-4;

/** Recover the White Balance menu label from the Temp/Tint offsets alone.
 *
 *  `wbMode` is V2-only intent — it is NOT in the engine ABI — so a params
 *  read-back (re-opening a developed Smart Object) has nothing else to go on.
 *  Exact zero is the decoder's own neutral (As Shot); an offset pair that
 *  matches one of the lighting presets is that preset; anything else was
 *  hand-dialled, i.e. Custom. Without the preset match, every image whose WB
 *  came from the menu would come back mislabelled "Custom".
 *  (Daylight's offsets ARE zero — it is the reference illuminant — so it is
 *  indistinguishable from As Shot; As Shot wins, as it is the safer claim.) */
export function inferWbMode(temp: number, tint: number): WhiteBalanceMode {
  if (temp === 0 && tint === 0) return "asShot";
  const preset = WB_PRESETS.find((p) => {
    const offsets = whiteBalancePresetOffsets(p.mode);
    return Math.abs(offsets.temp - temp) < WB_MATCH_EPSILON
      && Math.abs(offsets.tint - tint) < WB_MATCH_EPSILON;
  });
  return preset ? preset.mode : "custom";
}

/**
 * Map a canonical Vision CameraRaw recipe onto a DevelopRecipeV2, covering the
 * FULL surface (hsl→colorMixer, grade→colorGrading, geometry→transform, curve
 * authoring points, profile/calibration/crop/heal/pointColors/enhance/masks).
 * The ABI golden depends on this mapping; do NOT alter it without re-blessing
 * the golden.
 */
export function visionRecipeToV2(recipe: CanonicalCameraRawRecipe): DevelopRecipeV2 {
  const d = createDefaultRecipe();
  const b = recipe.basic;
  const det = recipe.detail;
  const e = recipe.effects;
  const o = recipe.optics;
  const hsl = recipe.hsl;
  const gr = recipe.grade;
  const geo = recipe.geometry;
  const c = recipe.curve;
  return {
    ...d,
    // Basic [2..14] — identical field names, verbatim. wbMode is V2-only intent
    // (not in the prefix), so it is recovered from the offsets (see inferWbMode).
    basic: {
      ...d.basic,
      wbMode: inferWbMode(b.temp, b.tint),
      temp: b.temp, tint: b.tint, exposure: b.exposure, contrast: b.contrast,
      highlights: b.highlights, shadows: b.shadows, whites: b.whites, blacks: b.blacks,
      texture: b.texture, clarity: b.clarity, dehaze: b.dehaze, vibrance: b.vibrance, saturation: b.saturation,
    },
    // Detail [15..19] — nrStrength→nrLuminance, nrDetail→nrLuminanceDetail.
    detail: {
      ...d.detail,
      sharpenAmount: det.sharpenAmount, sharpenRadius: det.sharpenRadius,
      nrLuminance: det.nrStrength, nrColor: det.nrColor, nrLuminanceDetail: det.nrDetail,
    },
    // Effects [20..24] — grainHighlight→grainRoughness, grainIntensity→grainSize.
    effects: {
      ...d.effects,
      grainAmount: e.grainAmount, grainRoughness: e.grainHighlight, grainSize: e.grainIntensity,
      vignetteAmount: e.vignetteAmount, vignetteMidpoint: e.vignetteMidpoint,
    },
    // curveEnabled [25].
    enabled: { ...d.enabled, toneCurve: c.enabled },
    // Curve LUTs [26..1049] — map the editable points; monet-photo recompiles the
    // same bytes via masterToneLut(point, parametric) / buildLut(channel).
    toneCurve: {
      ...d.toneCurve,
      parametric: { ...c.parametric },
      point: cloneCurvePoints(c.pointsByChannel[0]),
      red: cloneCurvePoints(c.pointsByChannel[1]),
      green: cloneCurvePoints(c.pointsByChannel[2]),
      blue: cloneCurvePoints(c.pointsByChannel[3]),
      // Carry Vision's DECOUPLED stored render LUTs verbatim (prefix-only; the
      // shared codec would otherwise compile points→LUT, which is correct for
      // Galerie but not for Vision's decoupled render prefix). Byte-exact:
      // verbatim == compile when the stored LUT is consistent with the points.
      ...(Array.isArray(c.master) && Array.isArray(c.r) && Array.isArray(c.g) && Array.isArray(c.b)
        ? { compiledLuts: { master: c.master, r: c.r, g: c.g, b: c.b } }
        : {}),
    },
    // Optics [1050..1052]. aberration is continuous on both sides — V2's
    // optics.aberration takes Vision's raw float verbatim, so [1051] is byte-exact.
    optics: {
      ...d.optics,
      ...normalizeLensSettings(o.lensProfile ?? o),
      distortionAmount: o.distortion,
      aberration: o.aberration,
      defringePurpleAmount: o.defringe,
    },
    // HSL [1053..1076] — Vision hsl.{hue,sat,lum} → V2 colorMixer.{hue,saturation,luminance}.
    colorMixer: {
      ...d.colorMixer,
      hue: hsl.hue.slice(), saturation: hsl.sat.slice(), luminance: hsl.lum.slice(),
    },
    // Color Grading [1077..1082] — hue/sat per region (V2 lum is not in the prefix).
    colorGrading: {
      ...d.colorGrading,
      shadows: { ...d.colorGrading.shadows, hue: gr.shadows.hue, sat: gr.shadows.sat },
      midtones: { ...d.colorGrading.midtones, hue: gr.midtones.hue, sat: gr.midtones.sat },
      highlights: { ...d.colorGrading.highlights, hue: gr.highlights.hue, sat: gr.highlights.sat },
    },
    // Geometry [1083..1085] — Vision geometry → V2 transform.
    transform: {
      ...d.transform,
      vertical: geo.vertical, horizontal: geo.horizontal, rotate: geo.rotate,
    },
    // Profile [1088..1089] — code+amount, derived from id via the SAME PROFILE_CODES.
    profile: {
      ...d.profile, id: recipe.profile.id, name: recipe.profile.name, amount: recipe.profile.amount,
      ...(recipe.profile.digest ? { digest: recipe.profile.digest } : {}),
      ...(recipe.profile.asShotKelvin ? { asShotKelvin: recipe.profile.asShotKelvin } : {}),
      ...(recipe.profile.sourceCamera ? { sourceCamera: recipe.profile.sourceCamera } : {}),
    },
    // Crop [1097..1106] (visionV2 tail) — Vision's x/y/width/height → rect{top,left,
    // bottom,right}; constrainAspect(bool)+aspectRatio collapse into number|null.
    crop: {
      ...d.crop,
      rect: {
        top: recipe.crop.y,
        left: recipe.crop.x,
        bottom: recipe.crop.y + recipe.crop.height,
        right: recipe.crop.x + recipe.crop.width,
      },
      angle: recipe.crop.angle,
      constrainAspect: recipe.crop.constrainAspect ? (recipe.crop.aspectRatio ?? 0) : null,
      flipHorizontal: recipe.crop.flipHorizontal,
      flipVertical: recipe.crop.flipVertical,
    },
    // Enhance [1107..1110] (visionV2 tail) — denoise/denoiseAmount/rawDetails/superResolution 1:1.
    enhance: { ...recipe.enhance },
    // Calibration [1090..1096] — shadowTint + red/green/blue (hue,sat).
    calibration: {
      ...d.calibration,
      shadowTint: recipe.calibration.shadowTint,
      redHue: recipe.calibration.red.hue, redSat: recipe.calibration.red.saturation,
      greenHue: recipe.calibration.green.hue, greenSat: recipe.calibration.green.saturation,
      blueHue: recipe.calibration.blue.hue, blueSat: recipe.calibration.blue.saturation,
    },
    // Heal [1111]=count, [1112..] 8-float records. 64-cap (recipe is already
    // normalized to ≤64). HealSpot drops the id (not serialized); rest maps 1:1.
    heal: {
      spots: recipe.healSpots.slice(0, MAX_HEAL_SPOTS).map((s) => ({
        mode: s.mode, x: s.x, y: s.y, sourceX: s.sourceX, sourceY: s.sourceY,
        radius: s.radius, feather: s.feather, opacity: s.opacity,
      })),
    },
    // Engine masks — field-for-field (id/name are not serialized, so dropped).
    // 32-cap (recipe is already normalized). range/colorSamples stay optional.
    engineMasks: recipe.masks.slice(0, MAX_ENGINE_MASKS).map((m): EngineMask => ({
      kind: m.kind,
      enabled: m.enabled,
      inverted: m.inverted,
      opacity: m.opacity,
      feather: m.feather,
      points: m.points.map((pt) => ({ x: pt.x, y: pt.y, pressure: pt.pressure })),
      ...(m.range ? { range: [m.range[0], m.range[1]] as [number, number] } : {}),
      ...(m.colorSamples ? { colorSamples: m.colorSamples.map((cs) => [cs[0], cs[1], cs[2]] as [number, number, number]) } : {}),
      adjustments: { ...m.adjustments },
    })),
    // Point Color [v3 socket block] — Vision refHue/refSat/refLum → srcHue/srcSat/
    // srcLum; hue/sat/lum/range map 1:1. 8-cap (recipe is already normalized).
    pointColor: {
      samples: recipe.pointColors.slice(0, MAX_POINT_COLOR_SAMPLES).map((p) => ({
        srcHue: p.refHue, srcSat: p.refSat, srcLum: p.refLum,
        hue: p.hue, sat: p.sat, lum: p.lum, range: p.range,
      })),
    },
  };
}
