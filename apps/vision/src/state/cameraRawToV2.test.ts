// Prefix-conformance proof for the Vision→V2 mapping (docs/plans/10 Phase 5).
//
// The unification only holds if the SAME engine-prefix bytes come out both
// ways: serialize a Vision recipe with Vision's codec, and serialize its V2
// mapping with monet-photo's codec — the first 1086 floats must be identical.
// The advanced tail diverges by design and is out of scope (slice(0, 1086)).
import { describe, it, expect } from "vitest";
import { recipeToParams as recipeToParamsV2, createDefaultRecipe } from "@monet-ui/monet-photo";
import { defaultRecipe, recipeToParams, type CanonicalCameraRawRecipe } from "./cameraRaw";
import { buildLut, masterToneLut } from "./toneCurve";
import { visionRecipeToV2 } from "./cameraRawToV2";

const PREFIX_LEN = 1086;

/** A Vision recipe with a NON-NEUTRAL value in every prefix group. The four
 *  curve LUTs are compiled from the editable points/parametric through the same
 *  masterToneLut/buildLut the migration relies on, so the prefix curve bytes and
 *  the authoring points are mutually consistent (as a real edited recipe is). */
function buildVisionRecipe(): CanonicalCameraRawRecipe {
  const r = defaultRecipe();
  r.basic = {
    temp: 0.25, tint: -0.125, exposure: 0.5, contrast: -0.25,
    highlights: -0.5, shadows: 0.75, whites: 0.25, blacks: -0.125,
    texture: 0.375, clarity: -0.25, dehaze: 0.125, vibrance: 0.5, saturation: -0.375,
  };
  r.detail = { sharpenAmount: 0.5, sharpenRadius: 2, nrStrength: 0.25, nrColor: 0.5, nrDetail: 0.75 };
  r.effects = { grainAmount: 0.25, grainHighlight: 0.5, grainIntensity: 0.375, vignetteAmount: -0.5, vignetteMidpoint: 0.25 };
  // aberration is continuous on both sides now — a mid/negative value round-trips
  // byte-exact at [1051] (no more boolean lossiness).
  r.optics = { distortion: 0.125, aberration: -0.25, defringe: 0.5 };
  r.hsl = {
    hue: [0.5, -0.25, 0.125, -0.5, 0.25, -0.125, 0.375, -0.375],
    sat: [-0.5, 0.25, -0.125, 0.5, -0.25, 0.125, -0.375, 0.375],
    lum: [0.25, -0.5, 0.375, -0.125, 0.5, -0.25, 0.125, -0.375],
  };
  r.grade = { shadows: { hue: 210, sat: 0.4 }, midtones: { hue: 40, sat: 0.2 }, highlights: { hue: 90, sat: 0.6 } };
  r.geometry = { vertical: 0.125, horizontal: -0.25, rotate: 0.5 };

  const point = [{ x: 0, y: 0 }, { x: 0.25, y: 0.375 }, { x: 0.75, y: 0.625 }, { x: 1, y: 1 }];
  const red = [{ x: 0, y: 0.05 }, { x: 1, y: 0.95 }];
  const green = [{ x: 0, y: 0 }, { x: 0.5, y: 0.5625 }, { x: 1, y: 1 }];
  const blue = [{ x: 0, y: 0.1 }, { x: 1, y: 0.9 }];
  const parametric = { highlights: 25, lights: -12, darks: 12, shadows: -25 };
  r.curve = {
    enabled: true,
    master: Array.from(masterToneLut(point, parametric)),
    r: Array.from(buildLut(red)),
    g: Array.from(buildLut(green)),
    b: Array.from(buildLut(blue)),
    pointsByChannel: [point, red, green, blue],
    parametric,
  };
  return r;
}

/** buildVisionRecipe plus a NON-NEUTRAL advanced-tail version-independent block:
 *  a creative profile (adobe-color @ 0.8), non-neutral calibration, and two heal
 *  spots (heal + clone). The prefix stays fully non-neutral, so serializing this
 *  exercises the prefix AND the tail block together. */
function buildAdvancedVisionRecipe(): CanonicalCameraRawRecipe {
  const r = buildVisionRecipe();
  r.profile = { id: "adobe-color", name: "Adobe Color", kind: "creative", amount: 0.8 };
  r.calibration = {
    shadowTint: 0.2,
    red: { hue: 0.1, saturation: -0.1 },
    green: { hue: 0.15, saturation: 0.05 },
    blue: { hue: -0.2, saturation: 0.25 },
  };
  r.healSpots = [
    { id: "h1", mode: "heal", x: 0.1, y: 0.2, sourceX: 0.3, sourceY: 0.4, radius: 0.05, feather: 0.5, opacity: 0.9 },
    { id: "h2", mode: "clone", x: 0.6, y: 0.7, sourceX: 0.8, sourceY: 0.9, radius: 0.03, feather: 0.25, opacity: 1 },
  ];
  return r;
}

// Advanced-tail offset map (version-independent block, both serializers):
//   [1086] magic  [1087] version(diverges)  [1088] profile code  [1089] amount
//   [1090] shadowTint  [1091..1096] red/green/blue (hue,sat)
//   [1097..1106] crop  [1107..1110] enhance  [1111] heal_count  [1112..] heal records(8 each)
const MAGIC = 1086;
const HEAL_COUNT_OFF = 1111;
const HEAL_BASE = 1112;

describe("Vision CameraRaw → DevelopRecipeV2 migration (advanced-tail version-independent block)", () => {
  const recipe = buildAdvancedVisionRecipe();
  const vp = Array.from(recipeToParams(recipe, 1));
  const mp = Array.from(recipeToParamsV2(visionRecipeToV2(recipe), 1));
  // A neutral recipe emits NO tail (ends at 1086) — the baseline for non-vacuity.
  const neutralTail = Array.from(recipeToParamsV2(createDefaultRecipe(), 1));

  it("reproduces the engine prefix [0..1086) and the magic [1086] byte-for-byte", () => {
    expect(mp.slice(0, PREFIX_LEN)).toEqual(vp.slice(0, PREFIX_LEN));
    expect(mp[MAGIC]).toBe(vp[MAGIC]); // DEV_ADVANCED_MAGIC (22026)
    expect(mp[MAGIC]).toBe(22026);
  });

  it("reproduces the profile + calibration block [1088..1097) byte-for-byte", () => {
    // [1088] profile code (adobe-color → 1, derived from the SAME PROFILE_CODES on
    // both sides), [1089] amount, [1090] shadowTint, [1091..1096] primary hue/sat.
    expect(mp.slice(1088, 1097)).toEqual(vp.slice(1088, 1097));
  });

  it("reproduces the enhance block + neutral crop, EXCLUDING crop width/height", () => {
    // crop.enabled/x/y [1097..1100), then crop angle/constrain/aspect/flips
    // [1102..1107) and enhance [1107..1111). [1100]/[1101] (crop width/height) are
    // a genuine divergence (see the dedicated pin below) and are excluded here.
    expect(mp.slice(1097, 1100)).toEqual(vp.slice(1097, 1100));
    expect(mp.slice(1102, 1111)).toEqual(vp.slice(1102, 1111));
  });

  it("reproduces heal_count [1111] and the heal records [1112..1128) byte-for-byte", () => {
    const healCount = vp[HEAL_COUNT_OFF];
    expect(healCount).toBe(2);
    expect(mp[HEAL_COUNT_OFF]).toBe(healCount);
    expect(mp.slice(HEAL_BASE, HEAL_BASE + 8 * healCount)).toEqual(vp.slice(HEAL_BASE, HEAL_BASE + 8 * healCount));
  });

  it("is non-vacuous: the tail block carries real profile/calibration/heal values", () => {
    // Neutral recipe → no tail (length 1086); this recipe → a real tail on both sides.
    expect(neutralTail.length).toBe(PREFIX_LEN);
    expect(vp.length).toBeGreaterThan(PREFIX_LEN);
    expect(mp.length).toBeGreaterThan(PREFIX_LEN);
    expect(vp[1088]).toBe(1);            // adobe-color (≠ camera-default 0)
    expect(vp[1089]).not.toBe(1);        // profile amount 0.8 (≠ neutral 1)
    expect(vp[1090]).not.toBe(0);        // shadowTint set
    expect(vp[HEAL_COUNT_OFF]).toBe(2);  // heal spots present
  });

  it("pins the KNOWN crop width/height divergence [1100]/[1101] in the shared block", () => {
    // Not reconcilable by the migration: developParams deliberately zeroes the
    // crop sub-block (Galerie applies crop in TS) and never reads recipe.crop,
    // while Vision serializes recipe.crop.{width,height} (default 1) into the
    // engine tail — and Vision's normalize clamps them to ≥0.00001, so they can
    // never be 0. Pinned so this real divergence can't silently drift.
    expect(vp[1100]).toBe(1); expect(mp[1100]).toBe(0); // crop.width
    expect(vp[1101]).toBe(1); expect(mp[1101]).toBe(0); // crop.height
  });
});

/** buildAdvancedVisionRecipe (profile/calibration/heals + authored curve) PLUS a
 *  non-identity crop and a full Enhance record, using the EXACT dyadic values of
 *  the cameraRaw.abi golden (crop flips + enhance included) so this proves the
 *  golden migrates byte-exact. NO masks, NO point colors — so monet-photo's
 *  visionV2 tail is byte-identical to Vision's over the FULL length. */
function buildConformanceRecipe(): CanonicalCameraRawRecipe {
  const r = buildAdvancedVisionRecipe();
  r.crop = {
    enabled: true,
    x: 0.125, y: 0.25, width: 0.75, height: 0.5,
    angle: 2, constrainAspect: true, aspectRatio: 1.5,
    flipHorizontal: true, flipVertical: false,
  };
  r.enhance = { denoise: true, denoiseAmount: 0.5, rawDetails: true, superResolution: true };
  return r;
}

describe("Vision CameraRaw → DevelopRecipeV2 migration (visionV2 tail, FULL-length conformance)", () => {
  const recipe = buildConformanceRecipe();
  const vp = Array.from(recipeToParams(recipe, 1));
  const mp = Array.from(recipeToParamsV2(visionRecipeToV2(recipe), 1, { tailFormat: "visionV2" }));

  it("emits the v2 tail version and identical lengths", () => {
    expect(vp[1087]).toBe(2); // Vision v2 (no point colors)
    expect(mp[1087]).toBe(2);
    expect(mp.length).toBe(vp.length);
    expect(vp.length).toBeGreaterThan(PREFIX_LEN); // non-vacuous tail
  });

  it("reproduces crop width/height [1100]/[1101] (the divergence the auto tail can't)", () => {
    expect(vp[1100]).toBe(0.75); expect(mp[1100]).toBe(0.75); // crop.width
    expect(vp[1101]).toBe(0.5); expect(mp[1101]).toBe(0.5); // crop.height
    expect(mp.slice(1097, 1107)).toEqual(vp.slice(1097, 1107)); // full crop block incl flips
  });

  it("reproduces the crop flips [1105]/[1106] and enhance [1107..1110] byte-for-byte", () => {
    // Superset visionV2 fields: crop.flipHorizontal/flipVertical + the full
    // Enhance record now round-trip, so the ABI golden migrates byte-exact.
    expect(vp[1105]).toBe(1); expect(mp[1105]).toBe(1); // flipHorizontal
    expect(vp[1106]).toBe(0); expect(mp[1106]).toBe(0); // flipVertical
    expect(mp.slice(1107, 1111)).toEqual([1, 0.5, 1, 1]); // denoise/amount/rawDetails/superRes
    expect(mp.slice(1107, 1111)).toEqual(vp.slice(1107, 1111));
  });

  it("reproduces the post-heal curve-authoring block byte-for-byte", () => {
    // After the profile/cal/crop/enhance block: heal_count[1111] + 2×8 heals +
    // mask_count(0), THEN 4 parametric floats + 4 channels [count, x,y…].
    const curveBase = 1111 + 1 + 2 * 8 + 1; // 1129: first parametric float
    expect(vp[1128]).toBe(0); expect(mp[1128]).toBe(0); // mask_count
    expect(mp.slice(curveBase, curveBase + 4)).toEqual([25, -12, 12, -25]); // parametric
    expect(mp.slice(curveBase, mp.length)).toEqual(vp.slice(curveBase, vp.length));
  });

  it("is byte-identical over the FULL length (no masks → nothing excluded)", () => {
    expect(mp).toEqual(vp);
  });
});

/** buildConformanceRecipe PLUS two non-neutral Point Color sockets. This forces
 *  Vision's tail to VERSION 3 (v2 tail + appended socket block); monet-photo's
 *  visionV2 tail must reproduce it byte-for-byte over the full length. */
function buildPointColorRecipe(): CanonicalCameraRawRecipe {
  const r = buildConformanceRecipe();
  r.pointColors = [
    { id: "pc1", refHue: 210, refSat: 0.5, refLum: 0.4, hue: 0.25, sat: -0.5, lum: 0.125, range: 0.375 },
    { id: "pc2", refHue: 40, refSat: 0.75, refLum: 0.6, hue: -0.125, sat: 0.5, lum: -0.25, range: 0.25 },
  ];
  return r;
}

describe("Vision CameraRaw → DevelopRecipeV2 migration (visionV2 tail, Point Color v3)", () => {
  const recipe = buildPointColorRecipe();
  const vp = Array.from(recipeToParams(recipe, 1));
  const mp = Array.from(recipeToParamsV2(visionRecipeToV2(recipe), 1, { tailFormat: "visionV2" }));

  it("emits the v3 tail version and identical lengths", () => {
    expect(vp[1087]).toBe(3); // Vision v3 (point colors present)
    expect(mp[1087]).toBe(3);
    expect(mp.length).toBe(vp.length);
  });

  it("appends the socket block after the curve authoring (count + 7 floats each)", () => {
    // socket count is the first float past the curve-authoring block; both codecs
    // land it at the same offset, so find it via the length: count + 2*7 floats.
    const socketBase = vp.length - (1 + 2 * 7);
    expect(vp[socketBase]).toBe(2); // socket count
    expect(mp[socketBase]).toBe(2);
    // First socket: refHue,refSat,refLum,hue,sat,lum,range (compared f32-to-f32).
    expect(mp[socketBase + 1]).toBe(210); // refHue
    expect(mp.slice(socketBase + 1, socketBase + 8)).toEqual(vp.slice(socketBase + 1, socketBase + 8));
  });

  it("is byte-identical over the FULL length (no masks → nothing excluded)", () => {
    expect(mp).toEqual(vp);
  });
});

/** buildConformanceRecipe PLUS two engine masks of different kinds (a brush with
 *  no range/colors, and an inverted color-range mask with a range + two color
 *  samples), each with non-neutral local adjustments. All values are dyadic and
 *  in-range so Vision's normalize is identity — the mapped V2 masks therefore
 *  serialize byte-for-byte. NO point colors → the tail stays v2. */
function buildMaskRecipe(): CanonicalCameraRawRecipe {
  const r = buildConformanceRecipe();
  r.masks = [
    {
      id: "m1", name: "Brush 1", kind: "brush",
      enabled: true, inverted: false, opacity: 0.75, feather: 0.5,
      points: [
        { x: 0.1, y: 0.2, pressure: 0.5 },
        { x: 0.3, y: 0.4, pressure: 1 },
        { x: 0.6, y: 0.7, pressure: 0.25 },
      ],
      adjustments: {
        temp: 0.25, tint: -0.5, exposure: 0.5, contrast: 0.125, highlights: -0.25,
        shadows: 0.375, whites: 0.5, blacks: -0.125, texture: 0.25, clarity: -0.375,
        dehaze: 0.125, saturation: -0.25, sharpness: 0.5, noiseReduction: 0.25,
        moire: 0.125, defringe: 0.375,
      },
    },
    {
      id: "m2", name: "Color 1", kind: "color-range",
      enabled: true, inverted: true, opacity: 0.5, feather: 0.25,
      points: [{ x: 0.5, y: 0.5, pressure: 1 }],
      range: [0.25, 0.75],
      colorSamples: [[128, 64, 200], [10, 240, 55]],
      adjustments: {
        temp: -0.25, tint: 0.5, exposure: -0.5, contrast: -0.125, highlights: 0.25,
        shadows: -0.375, whites: -0.5, blacks: 0.125, texture: -0.25, clarity: 0.375,
        dehaze: -0.125, saturation: 0.25, sharpness: -0.5, noiseReduction: -0.25,
        moire: -0.125, defringe: -0.375,
      },
    },
  ];
  return r;
}

describe("Vision CameraRaw → DevelopRecipeV2 migration (visionV2 tail, engine masks)", () => {
  const recipe = buildMaskRecipe();
  const vp = Array.from(recipeToParams(recipe, 1));
  const mp = Array.from(recipeToParamsV2(visionRecipeToV2(recipe), 1, { tailFormat: "visionV2" }));

  it("emits a non-zero mask_count at the post-heal offset", () => {
    // mask_count sits right after heal_count[1111] + 2×8 heal records.
    const maskCountOff = 1111 + 1 + 2 * 8; // 1128
    expect(vp[maskCountOff]).toBe(2);
    expect(mp[maskCountOff]).toBe(2);
    expect(mp.length).toBe(vp.length);
    expect(vp[1087]).toBe(2); // still the v2 tail (no point colors)
  });

  it("is byte-identical over the FULL length (masks emitted verbatim)", () => {
    expect(mp).toEqual(vp);
  });
});

describe("Vision CameraRaw → DevelopRecipeV2 mapping (renamed/derived fields)", () => {
  // The byte-identity suites above pin everything the ABI carries; these are the
  // remaps that are easier to diagnose at field level than as a float diff.
  const v = visionRecipeToV2(buildPointColorRecipe());

  it("renames the Detail/Effects/Optics fields", () => {
    expect(v.detail.nrLuminance).toBe(0.25); // was nrStrength
    expect(v.detail.nrLuminanceDetail).toBe(0.75); // was nrDetail
    expect(v.effects.grainSize).toBe(0.375); // was grainIntensity
    expect(v.effects.grainRoughness).toBe(0.5); // was grainHighlight
    expect(v.optics.distortionAmount).toBe(0.125);
    expect(v.optics.defringePurpleAmount).toBe(0.5);
  });

  it("derives the crop rect and collapses constrainAspect into a number|null", () => {
    expect(v.crop.rect).toEqual({ top: 0.25, left: 0.125, bottom: 0.75, right: 0.875 });
    expect(v.crop.constrainAspect).toBe(1.5);
  });

  it("carries the non-ABI profile name and infers wbMode", () => {
    expect(v.profile.name).toBe("Adobe Color");
    expect(v.basic.wbMode).toBe("custom"); // temp/tint are non-zero
  });

  it("remaps point-color reference channels (refHue → srcHue)", () => {
    expect(v.pointColor.samples[0]).toEqual({
      srcHue: 210, srcSat: 0.5, srcLum: 0.4, hue: 0.25, sat: -0.5, lum: 0.125, range: 0.375,
    });
  });
});

describe("Vision CameraRaw → DevelopRecipeV2 migration (prefix conformance)", () => {
  const recipe = buildVisionRecipe();
  const visionPrefix = Array.from(recipeToParams(recipe, 1)).slice(0, PREFIX_LEN);
  const v2Prefix = Array.from(recipeToParamsV2(visionRecipeToV2(recipe), 1)).slice(0, PREFIX_LEN);
  const neutralPrefix = Array.from(recipeToParamsV2(createDefaultRecipe(), 1)).slice(0, PREFIX_LEN);

  it("reproduces Vision's engine prefix byte-for-byte", () => {
    expect(v2Prefix.length).toBe(PREFIX_LEN);
    expect(v2Prefix).toEqual(visionPrefix);
  });

  it("carries the continuous optics aberration verbatim to [1051]", () => {
    // The value that used to be boolean-lossy: -0.25 now survives byte-exact.
    expect(visionPrefix[1051]).toBe(-0.25);
    expect(v2Prefix[1051]).toBe(-0.25);
  });

  it("is non-trivial (differs from the all-neutral default prefix)", () => {
    expect(visionPrefix).not.toEqual(neutralPrefix);
    // Spot-check representatives of each group actually moved off neutral.
    expect(visionPrefix[2]).not.toBe(neutralPrefix[2]);   // Basic.temp
    expect(visionPrefix[15]).not.toBe(neutralPrefix[15]); // Detail.sharpenAmount
    expect(visionPrefix[20]).not.toBe(neutralPrefix[20]); // Effects.grainAmount
    expect(visionPrefix[282]).not.toBe(neutralPrefix[282]); // curve red LUT[0] (y-offset 0.05)
    expect(visionPrefix[1050]).not.toBe(neutralPrefix[1050]); // Optics.distortion
    expect(visionPrefix[1053]).not.toBe(neutralPrefix[1053]); // HSL hue band 0
    expect(visionPrefix[1077]).not.toBe(neutralPrefix[1077]); // Grade shadows hue
    expect(visionPrefix[1083]).not.toBe(neutralPrefix[1083]); // Geometry vertical
  });
});
