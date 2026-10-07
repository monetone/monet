// Unit tests for the Camera Raw develop recipe ⇄ params codec. Engine-free
// (node); the preview pipeline + one-history-step apply are covered by
// e2e/camera-raw-workspace.spec.ts. The offset assertions here are the guard
// against a silent drift from the Rust `develop_buf` layout.
import { describe, it, expect } from "vitest";
import {
  autoWhiteBalance,
  CAMERA_RAW_ADVANCED_MAGIC,
  CAMERA_RAW_ADVANCED_VERSION,
  CAMERA_RAW_ADVANCED_V3,
  CAMERA_RAW_ADVANCED_V4,
  CAMERA_RAW_ADVANCED_V5,
  CAMERA_RAW_RECIPE_VERSION,
  CAMERA_RAW_PARAMS_LEN,
  CAMERA_RAW_SOURCE_VERSION,
  CAMERA_RAW_VERSION,
  cloneCameraRawRecipe,
  clippingCounts,
  compileCurveLuts,
  defaultCameraRawLocalAdjustments,
  defaultRecipe,
  MAX_CAMERA_RAW_CURVE_POINTS_PER_CHANNEL,
  MAX_CAMERA_RAW_HEAL_SPOTS,
  MAX_CAMERA_RAW_MASK_COLORS,
  MAX_CAMERA_RAW_MASK_POINTS,
  MAX_CAMERA_RAW_MASKS,
  MAX_CAMERA_RAW_POINT_COLORS,
  MAX_CAMERA_RAW_SOURCE_BYTES,
  normalizeCameraRawRecipe,
  normalizeCameraRawSourceMetadata,
  paramsToRecipe,
  parametricCurvePoints,
  proxyMaxDim,
  readAdvancedTrailer,
  recipeToParams,
  type CameraRawRecipe,
} from "./cameraRaw";
import { cloneCameraRawSource, normalizeCameraRawSource } from "./cameraRawSource";
import { buildLut } from "./toneCurve";
import { engineParamsToWorkingRecipe, normalizeWorkingRecipe, workingRecipeToParams } from "./visionDevelopRecipe";

const CURVE_BASE = 26;

describe("recipeToParams — layout contract", () => {
  it("emits exactly 1086 floats (26 header/scalar + 4×256 LUT + 3 Optics + 24 HSL + 6 Grade + 3 Geometry)", () => {
    expect(CAMERA_RAW_PARAMS_LEN).toBe(1086);
    expect(recipeToParams(defaultRecipe()).length).toBe(1086);
    expect(CURVE_BASE + 4 * 256).toBe(1050); // LUT end; Optics 1050.., HSL 1053.., Grade 1077.., Geometry 1083..
  });

  it("default recipe compiles to identity params with header [1, 1]", () => {
    const p = recipeToParams(defaultRecipe());
    // Golden: version + proxyScale header, neutral scalars, disabled curve, four
    // identity LUTs, neutral (0) Optics, neutral (0) HSL bands, neutral (0) Color
    // Grading wheels, and neutral (0) Geometry. Built so the layout is documented.
    const expected = new Float32Array(1086);
    expected[0] = 1; // version
    expected[1] = 1; // proxyScale
    expected[16] = 1; // sharpenRadius neutral default
    expected[24] = 0.5; // vignetteMidpoint neutral default
    for (let ch = 0; ch < 4; ch++) {
      for (let i = 0; i < 256; i++) expected[CURVE_BASE + ch * 256 + i] = i;
    }
    expect(p[0]).toBe(1);
    expect(p[1]).toBe(1);
    expect(p[25]).toBe(0); // curve disabled
    expect(Array.from(p)).toEqual(Array.from(expected));
  });

  it("places each Basic/Detail/Effects value at its exact offset", () => {
    const r = defaultRecipe();
    r.basic = {
      temp: 0.5, tint: -0.25, exposure: 1.5, contrast: 0.125,
      highlights: -0.5, shadows: 0.75, whites: 0.25, blacks: -0.125,
      texture: 0.5, clarity: -0.75, dehaze: 0.25, vibrance: -0.5, saturation: 0.375,
    };
    r.detail = { sharpenAmount: 0.5, sharpenRadius: 2, nrStrength: 0.25, nrColor: 0.5, nrDetail: 0.75 };
    r.effects = { grainAmount: 0.5, grainHighlight: 0.25, grainIntensity: 0.75, vignetteAmount: -0.5, vignetteMidpoint: 0.25 };
    r.optics = { distortion: -0.5, aberration: 0.25, defringe: 0.75 };
    // HSL: three 8-slider blocks at 1053 (hue), 1061 (sat), 1069 (lum). Probe the
    // first entry of each block plus a mid-band entry to catch a block swap.
    r.hsl = {
      hue: [0.5, 0, 0, 0, 0, 0, 0, -0.5],
      sat: [0, 0, 0, 0.25, 0, 0, 0, 0],
      lum: [0, 0, 0, 0, 0, -0.75, 0, 0],
    };
    const p = recipeToParams(r);
    expect(p[1050]).toBeCloseTo(-0.5); expect(p[1051]).toBeCloseTo(0.25); expect(p[1052]).toBeCloseTo(0.75);
    expect(p[1053]).toBeCloseTo(0.5); expect(p[1060]).toBeCloseTo(-0.5); // hue[0], hue[7]
    expect(p[1064]).toBeCloseTo(0.25); // sat[3]
    expect(p[1074]).toBeCloseTo(-0.75); // lum[5] (1069 + 5)
    // Color Grading: (hue, sat) pairs at 1077 (shadows), 1079 (mid), 1081 (hi).
    r.grade = {
      shadows: { hue: 210, sat: 0.4 }, midtones: { hue: 40, sat: 0.2 }, highlights: { hue: 90, sat: 0.6 },
    };
    // Geometry: vertical, horizontal, rotate at 1083..1086.
    r.geometry = { vertical: 0.5, horizontal: -0.25, rotate: 0.75 };
    const p2 = recipeToParams(r);
    expect(p2[1077]).toBeCloseTo(210); expect(p2[1078]).toBeCloseTo(0.4);
    expect(p2[1079]).toBeCloseTo(40); expect(p2[1080]).toBeCloseTo(0.2);
    expect(p2[1081]).toBeCloseTo(90); expect(p2[1082]).toBeCloseTo(0.6);
    expect(p2[1083]).toBeCloseTo(0.5); expect(p2[1084]).toBeCloseTo(-0.25); expect(p2[1085]).toBeCloseTo(0.75);
    expect(p[2]).toBeCloseTo(0.5); expect(p[3]).toBeCloseTo(-0.25);
    expect(p[4]).toBeCloseTo(1.5); expect(p[5]).toBeCloseTo(0.125);
    expect(p[6]).toBeCloseTo(-0.5); expect(p[7]).toBeCloseTo(0.75);
    expect(p[8]).toBeCloseTo(0.25); expect(p[9]).toBeCloseTo(-0.125);
    expect(p[10]).toBeCloseTo(0.5); expect(p[11]).toBeCloseTo(-0.75);
    expect(p[12]).toBeCloseTo(0.25); expect(p[13]).toBeCloseTo(-0.5); expect(p[14]).toBeCloseTo(0.375);
    expect(p[15]).toBeCloseTo(0.5); expect(p[16]).toBeCloseTo(2);
    expect(p[17]).toBeCloseTo(0.25); expect(p[18]).toBeCloseTo(0.5); expect(p[19]).toBeCloseTo(0.75);
    expect(p[20]).toBeCloseTo(0.5); expect(p[21]).toBeCloseTo(0.25); expect(p[22]).toBeCloseTo(0.75);
    expect(p[23]).toBeCloseTo(-0.5); expect(p[24]).toBeCloseTo(0.25);
  });
});

describe("proxyScale", () => {
  it("differs from scale 1 ONLY in header slot [1] (values never pre-scaled)", () => {
    const r = defaultRecipe();
    r.basic.texture = 0.5; // a spatial (radius-driven) value the engine scales
    r.detail.sharpenAmount = 0.5; r.detail.sharpenRadius = 2;
    const full = recipeToParams(r, 1);
    const half = recipeToParams(r, 0.5);
    expect(half[1]).toBe(0.5);
    expect(full[1]).toBe(1);
    for (let i = 0; i < CAMERA_RAW_PARAMS_LEN; i++) {
      if (i === 1) continue;
      expect(half[i]).toBe(full[i]);
    }
  });
});

describe("round-trip", () => {
  it("paramsToRecipe∘recipeToParams is bit-exact on a full crafted params array", () => {
    // Distinct f32-safe values at every scalar + a non-identity curve so a
    // dropped/swapped offset is caught. LUT values stay integer (round-trip exact).
    const src = new Float32Array(CAMERA_RAW_PARAMS_LEN);
    src[0] = CAMERA_RAW_VERSION;
    src[1] = 1;
    for (let i = 2; i <= 25; i++) src[i] = (i - 12) / 8; // f32-representable
    src[25] = 1; // curve enabled
    for (let ch = 0; ch < 4; ch++) {
      for (let i = 0; i < 256; i++) src[CURVE_BASE + ch * 256 + i] = (i + ch * 7) & 255;
    }
    const back = recipeToParams(paramsToRecipe(src));
    expect(Array.from(back)).toEqual(Array.from(src));
  });

  it("recipeToParams∘paramsToRecipe preserves a hand-built recipe", () => {
    const r = defaultRecipe();
    r.basic.exposure = 0.5; r.basic.contrast = -0.25; r.basic.temp = 0.125;
    r.detail.sharpenAmount = 0.75; r.effects.vignetteAmount = -0.5;
    r.optics = { distortion: -0.25, aberration: 0.5, defringe: 0.125 };
    r.hsl = {
      hue: [0.125, -0.25, 0, 0.5, 0, 0, -0.375, 0],
      sat: [0, 0.75, 0, 0, -0.5, 0, 0, 0.25],
      lum: [-0.125, 0, 0.5, 0, 0, 0.625, 0, -0.75],
    };
    r.grade = {
      shadows: { hue: 220, sat: 0.5 }, midtones: { hue: 30, sat: 0.125 }, highlights: { hue: 60, sat: 0.75 },
    };
    r.geometry = { vertical: -0.375, horizontal: 0.25, rotate: -0.5 };
    r.curve.enabled = true;
    const round = paramsToRecipe(recipeToParams(r));
    expect(round).toEqual(r);
  });

  it("round-trips a bidirectional-gradient local mask (ACR 18.4, kind code 8)", () => {
    const r = defaultRecipe();
    r.masks = [{
      id: "mask-1", name: "bidirectional gradient 1", kind: "bidirectional-gradient",
      enabled: true, inverted: false, opacity: 1, feather: 0.5,
      points: [{ x: 0.25, y: 0.5, pressure: 1 }, { x: 0.75, y: 0.5, pressure: 1 }],
      range: [0, 0],
      adjustments: { ...defaultCameraRawLocalAdjustments(), exposure: 0.4 },
    }];
    const round = paramsToRecipe(recipeToParams(r));
    expect(round.masks).toHaveLength(1);
    expect(round.masks[0].kind).toBe("bidirectional-gradient"); // survives the numeric code
    expect(round.masks[0].points).toEqual(r.masks[0].points);
    expect(round.masks[0].feather).toBeCloseTo(0.5, 5);
    expect(round.masks[0].adjustments.exposure).toBeCloseTo(0.4, 5);
  });

  it("a full-length params array parses and round-trips exactly", () => {
    const p = recipeToParams(defaultRecipe());
    expect(p.length).toBe(CAMERA_RAW_PARAMS_LEN);
    const round = recipeToParams(paramsToRecipe(p));
    expect(Array.from(round)).toEqual(Array.from(p));
  });

  it("a legacy 1050-length array (pre-Optics) parses with neutral Optics/HSL/Grade/Geometry and re-serializes to 1086", () => {
    // Back-compat: a recipe stored before Optics/HSL/Grade/Geometry were appended
    // is 1050 long; the with-default read fills them all with 0 (identity) and the
    // fresh params array is the new length.
    const legacy = recipeToParams(defaultRecipe()).slice(0, 1050);
    const rec = paramsToRecipe(legacy);
    expect(rec.optics).toEqual({ distortion: 0, aberration: 0, defringe: 0 });
    expect(rec.hsl).toEqual({ hue: Array(8).fill(0), sat: Array(8).fill(0), lum: Array(8).fill(0) });
    expect(rec.grade).toEqual({
      shadows: { hue: 0, sat: 0 }, midtones: { hue: 0, sat: 0 }, highlights: { hue: 0, sat: 0 },
    });
    expect(rec.geometry).toEqual({ vertical: 0, horizontal: 0, rotate: 0 });
    expect(recipeToParams(rec).length).toBe(1086);
  });

  it("a 1083-length array (pre-Geometry) parses with neutral Geometry, preserving Grade", () => {
    // A recipe stored after Color Grading but before Geometry: a grading wheel
    // survives and the three geometry sliders default to neutral.
    const r = defaultRecipe();
    r.grade.midtones = { hue: 45, sat: 0.3 };
    const preGeo = recipeToParams(r).slice(0, 1083);
    const rec = paramsToRecipe(preGeo);
    expect(rec.grade.midtones.hue).toBeCloseTo(45);
    expect(rec.geometry).toEqual({ vertical: 0, horizontal: 0, rotate: 0 });
  });

  it("a 1053-length array (pre-HSL) parses with neutral HSL, preserving Optics", () => {
    // A recipe stored after Optics but before HSL: the Optics values survive and
    // the eight HSL bands default to neutral.
    const r = defaultRecipe();
    r.optics = { distortion: -0.3, aberration: 0.4, defringe: 0.2 };
    const preHsl = recipeToParams(r).slice(0, 1053);
    const rec = paramsToRecipe(preHsl);
    expect(rec.optics.distortion).toBeCloseTo(-0.3);
    expect(rec.hsl).toEqual({ hue: Array(8).fill(0), sat: Array(8).fill(0), lum: Array(8).fill(0) });
  });

  it("a 1077-length array (pre-Grade) parses with neutral Color Grading, preserving HSL", () => {
    // A recipe stored after HSL but before Color Grading: an HSL band survives and
    // the three grading wheels default to neutral.
    const r = defaultRecipe();
    r.hsl.sat[2] = -0.5; // Yellow band desaturate
    const preGrade = recipeToParams(r).slice(0, 1077);
    const rec = paramsToRecipe(preGrade);
    expect(rec.hsl.sat[2]).toBeCloseTo(-0.5);
    expect(rec.grade).toEqual({
      shadows: { hue: 0, sat: 0 }, midtones: { hue: 0, sat: 0 }, highlights: { hue: 0, sat: 0 },
    });
  });

  it("a shorter (truncated) array parses with neutral/identity defaults", () => {
    const short = recipeToParams(defaultRecipe()).slice(0, 20); // header + partial Basic
    const rec = paramsToRecipe(short);
    expect(rec.effects.vignetteAmount).toBe(0); // missing scalar → 0
    expect(rec.curve.master[128]).toBe(128); // missing LUT → identity
    expect(rec.curve.enabled).toBe(false);
  });

  it("round-trips the bounded advanced engine tail without layout drift", () => {
    const recipe = defaultRecipe();
    recipe.profile = { id: "adobe-color", name: "Adobe Color", kind: "creative", amount: 0.75 };
    recipe.calibration = {
      shadowTint: -0.25,
      red: { hue: 0.5, saturation: 0.25 },
      green: { hue: -0.5, saturation: 0.125 },
      blue: { hue: 0.25, saturation: -0.25 },
    };
    recipe.crop = {
      enabled: true, x: 0.125, y: 0.25, width: 0.75, height: 0.5, angle: 2,
      constrainAspect: true, aspectRatio: 1.5, flipHorizontal: true, flipVertical: false,
    };
    recipe.healSpots = [{
      id: "dust", mode: "clone", x: 0.5, y: 0.25, sourceX: 0.375, sourceY: 0.25,
      radius: 0.0625, feather: 0.5, opacity: 0.75,
    }];
    recipe.masks = [{
      id: "mask", name: "Mask", kind: "brush", enabled: true, inverted: true,
      opacity: 0.75, feather: 0.25, range: [0.125, 0.875],
      points: [{ x: 0.25, y: 0.5, pressure: 0.75 }],
      colorSamples: [[16, 32, 64]],
      adjustments: { ...defaultCameraRawLocalAdjustments(), exposure: 0.5, texture: -0.25 },
    }, {
      id: "ai", name: "AI subject", kind: "outline", enabled: true, inverted: false,
      opacity: 1, feather: 0.5, range: [0, 1],
      // A persisted matte outline: closed polygon, pressure fixed at 1.
      // Dyadic fractions — exact through the Float32Array params round-trip.
      points: [
        { x: 0.25, y: 0.25, pressure: 1 }, { x: 0.75, y: 0.25, pressure: 1 },
        { x: 0.75, y: 0.875, pressure: 1 }, { x: 0.25, y: 0.875, pressure: 1 },
      ],
      colorSamples: [],
      adjustments: { ...defaultCameraRawLocalAdjustments(), exposure: -0.25 },
    }];
    recipe.enhance = { denoise: true, denoiseAmount: 0.5, rawDetails: true, superResolution: true };

    const encoded = recipeToParams(recipe);
    expect(encoded.length).toBeGreaterThan(CAMERA_RAW_PARAMS_LEN);
    expect(encoded[CAMERA_RAW_PARAMS_LEN]).toBe(CAMERA_RAW_ADVANCED_MAGIC);
    const decoded = paramsToRecipe(encoded);
    expect(decoded.profile).toEqual(recipe.profile);
    expect(decoded.calibration).toEqual(recipe.calibration);
    expect(decoded.crop).toEqual(recipe.crop);
    expect(decoded.healSpots[0]).toMatchObject({ mode: "clone", x: 0.5, sourceX: 0.375, opacity: 0.75 });
    expect(decoded.masks[0]).toMatchObject({ kind: "brush", enabled: true, inverted: true, range: [0.125, 0.875] });
    expect(decoded.masks[0].adjustments.exposure).toBe(0.5);
    expect(decoded.masks[1]).toMatchObject({ kind: "outline" });
    expect(decoded.masks[1].points).toHaveLength(4);
    expect(decoded.masks[1].points[2]).toEqual({ x: 0.75, y: 0.875, pressure: 1 });
    expect(decoded.masks[1].adjustments.exposure).toBe(-0.25);
    expect(decoded.enhance).toEqual(recipe.enhance);
    expect(Array.from(recipeToParams(decoded))).toEqual(Array.from(encoded));
  });

  it("reads legacy v1 advanced tails and upgrades them to v2", () => {
    const recipe = defaultRecipe();
    recipe.profile = { id: "adobe-color", name: "Adobe Color", kind: "creative", amount: 0.75 };
    const encoded = recipeToParams(recipe);
    expect(encoded[1087]).toBe(CAMERA_RAW_ADVANCED_VERSION);

    // A v1 tail ended immediately after the mask-count slot when there were no masks.
    const legacy = encoded.slice(0, 1113);
    legacy[1087] = 1;
    const decoded = paramsToRecipe(legacy);
    expect(decoded.profile).toEqual(recipe.profile);
    expect(decoded.curve.pointsByChannel).toEqual(defaultRecipe().curve.pointsByChannel);
    expect(decoded.curve.parametric).toEqual(defaultRecipe().curve.parametric);
    expect(recipeToParams(decoded)[1087]).toBe(CAMERA_RAW_ADVANCED_VERSION);
  });

  it("rejects the advanced tail atomically and rejects unknown base versions", () => {
    const recipe = defaultRecipe();
    recipe.healSpots = [{
      id: "dust", mode: "heal", x: 0.5, y: 0.5, sourceX: 0.4, sourceY: 0.5,
      radius: 0.05, feather: 0.5, opacity: 1,
    }];
    recipe.masks = [{
      id: "mask", name: "Mask", kind: "brush", enabled: true, inverted: false,
      opacity: 1, feather: 0.5, points: [], adjustments: defaultCameraRawLocalAdjustments(),
    }];
    const encoded = recipeToParams(recipe);
    for (const malformed of [encoded.slice(0, -1), new Float32Array([...encoded, 123])]) {
      const decoded = paramsToRecipe(malformed);
      expect(decoded.healSpots).toEqual([]);
      expect(decoded.profile.id).toBe("camera-default");
    }
    const nonFinite = encoded.slice();
    nonFinite[1112] = Number.NaN;
    expect(paramsToRecipe(nonFinite).healSpots).toEqual([]);
    for (const [offset, value] of [[1088, 0.5], [1112, 0.5], [1121, 0.5]] as const) {
      const fractionalEnum = encoded.slice();
      fractionalEnum[offset] = value;
      const decoded = paramsToRecipe(fractionalEnum);
      expect(decoded.profile.id).toBe("camera-default");
      expect(decoded.healSpots).toEqual([]);
      expect(decoded.masks).toEqual([]);
    }
    const future = recipeToParams(defaultRecipe());
    future[0] = CAMERA_RAW_VERSION + 1;
    expect(() => paramsToRecipe(future)).toThrow(/Unsupported Camera Raw engine recipe version/);
  });

  it("round-trips Point Color sockets through a V3 tail and stays V2 without them", () => {
    // A recipe with no point-color sockets keeps the V2 tail, so older apps
    // that only know V2 keep reading it.
    const plain = defaultRecipe();
    plain.profile = { id: "adobe-color", name: "Adobe Color", kind: "creative", amount: 0.75 };
    expect(recipeToParams(plain)[1087]).toBe(CAMERA_RAW_ADVANCED_VERSION);

    // Adding a socket upgrades the tail to V3; the sockets round-trip exactly
    // (dyadic fractions are exact through the Float32Array) and re-encode stably.
    const recipe = defaultRecipe();
    recipe.pointColors = [
      { id: "point-color-1", refHue: 120, refSat: 0.5, refLum: 0.5, hue: 0.25, sat: -0.5, lum: 0.125, range: 0.5 },
      { id: "point-color-2", refHue: 240, refSat: 0.75, refLum: 0.25, hue: -0.5, sat: 0.25, lum: 0, range: 0.25 },
    ];
    const encoded = recipeToParams(recipe);
    expect(encoded[1087]).toBe(CAMERA_RAW_ADVANCED_V3);
    const decoded = paramsToRecipe(encoded);
    expect(decoded.pointColors).toEqual(recipe.pointColors);
    expect(Array.from(recipeToParams(decoded))).toEqual(Array.from(encoded));
  });

  it("rejects a malformed V3 point-color tail atomically", () => {
    const recipe = defaultRecipe();
    recipe.pointColors = [{ id: "point-color-1", refHue: 30, refSat: 1, refLum: 0.5, hue: 1, sat: 0, lum: 0, range: 0 }];
    const encoded = recipeToParams(recipe);
    // A trailing byte or a truncation drops the whole tail (point colors and all).
    for (const malformed of [encoded.slice(0, -1), new Float32Array([...encoded, 7])]) {
      expect(paramsToRecipe(malformed).pointColors).toEqual([]);
    }
    // An over-max socket count (last 8 slots are count + one 7-float socket) rejects too.
    const overlong = encoded.slice();
    overlong[encoded.length - 8] = MAX_CAMERA_RAW_POINT_COLORS + 1;
    expect(paramsToRecipe(overlong).pointColors).toEqual([]);
  });

  /** A working recipe using every V5 field plus tail-only heal/crop state.
   *  Dyadic values stay exact through the Float32Array. */
  const v5Working = () => {
    const r = normalizeWorkingRecipe({});
    r.heal.spots.push({ id: "heal-1", mode: "clone", x: 0.25, y: 0.5, sourceX: 0.75, sourceY: 0.5, radius: 0.125, feather: 0.5, opacity: 1 });
    r.crop.rect = { top: 0.125, left: 0.25, bottom: 0.875, right: 0.75 };
    r.detail = { ...r.detail, sharpenDetail: 60, sharpenMasking: 30, nrLuminanceContrast: 20, nrColorDetail: 10, nrColorSmoothness: 80 };
    r.optics = { ...r.optics, vignettingAmount: -0.5, defringePurpleHue: [20, 80], defringeGreenAmount: 0.25, defringeGreenHue: [35, 65] };
    r.transform = { ...r.transform, upright: "level", rotate: 0.125, scale: 1.25, xOffset: -0.5, aspect: 0.25 };
    return r;
  };

  it("reads a V5 tail back without dropping heals/crop and restores every tail-only field (#444)", () => {
    const working = v5Working();
    const params = workingRecipeToParams(working);
    expect(params[1087]).toBe(CAMERA_RAW_ADVANCED_V5);
    const decoded = paramsToRecipe(params);
    expect(decoded.healSpots).toHaveLength(1);
    expect(decoded.crop.enabled).toBe(true);
    const back = engineParamsToWorkingRecipe(params);
    expect(back.detail).toEqual(working.detail);
    expect(back.optics).toEqual(working.optics);
    expect(back.transform).toEqual(working.transform);
    // A reopen re-serializes to the exact same bytes.
    expect(Array.from(workingRecipeToParams(back))).toEqual(Array.from(params));
  });

  it("reads a V4 (transform-only) tail back with no extras", () => {
    const working = normalizeWorkingRecipe({});
    working.transform.scale = 1.5;
    working.heal.spots.push({ id: "heal-1", mode: "heal", x: 0.5, y: 0.5, sourceX: 0.25, sourceY: 0.5, radius: 0.125, feather: 0.5, opacity: 1 });
    const params = workingRecipeToParams(working);
    expect(params[1087]).toBe(CAMERA_RAW_ADVANCED_V4);
    const trailer = readAdvancedTrailer(params);
    expect(trailer?.transform.scale).toBe(1.5);
    expect(trailer?.extras).toBeUndefined();
    expect(paramsToRecipe(params).healSpots).toHaveLength(1);
    expect(engineParamsToWorkingRecipe(params).transform.scale).toBe(1.5);
  });

  it("rejects a V5 tail with an out-of-range extra atomically", () => {
    const params = workingRecipeToParams(v5Working());
    for (const [fromEnd, value] of [[12, 101], [7, 2], [6, 90], [1, 6]] as const) {
      const bad = params.slice();
      bad[bad.length - fromEnd] = value; // sharpen detail, vignetting, purple lo > hi, upright code
      expect(readAdvancedTrailer(bad)).toBeNull();
      expect(paramsToRecipe(bad).healSpots).toEqual([]);
    }
  });
});

describe("canonical persisted Camera Raw state", () => {
  it("round-trips the v2 recipe including editable curves and source-level features", () => {
    const recipe = defaultRecipe();
    recipe.basic.exposure = 1.25;
    recipe.curve.enabled = true;
    recipe.curve.pointsByChannel = [
      [{ x: 0, y: 0 }, { x: 0.4, y: 0.55 }, { x: 1, y: 1 }],
      [{ x: 0, y: 0.1 }, { x: 1, y: 0.9 }],
      [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      [{ x: 0, y: 0 }, { x: 0.7, y: 0.6 }, { x: 1, y: 1 }],
    ];
    recipe.curve.parametric = { highlights: 25, lights: -10, darks: 15, shadows: -20 };
    recipe.profile = { id: "acme-neutral-v3", name: "Acme Neutral", kind: "custom", amount: 0.8 };
    recipe.calibration = {
      shadowTint: -0.2,
      red: { hue: 0.1, saturation: 0.2 },
      green: { hue: -0.1, saturation: 0.05 },
      blue: { hue: 0.25, saturation: -0.15 },
    };
    recipe.crop = {
      enabled: true, x: 0.1, y: 0.15, width: 0.75, height: 0.7, angle: 1.5,
      constrainAspect: true, aspectRatio: 1.5, flipHorizontal: true, flipVertical: false,
    };
    recipe.healSpots = [{
      id: "dust-1", mode: "heal", x: 0.4, y: 0.5, sourceX: 0.3, sourceY: 0.5,
      radius: 0.02, feather: 0.75, opacity: 0.9,
    }];
    recipe.masks = [{
      id: "subject-1", name: "Subject", kind: "brush", enabled: true, inverted: false,
      opacity: 0.85, feather: 0.4,
      points: [{ x: 0.25, y: 0.3, pressure: 0.7 }, { x: 0.3, y: 0.35, pressure: 1 }],
      adjustments: {
        ...defaultCameraRawLocalAdjustments(),
        temp: 0.1, exposure: 0.5, texture: 0.2, noiseReduction: 0.3,
      },
    }];
    recipe.enhance = { denoise: true, denoiseAmount: 0.65, rawDetails: true, superResolution: false };

    const normalized = normalizeCameraRawRecipe(structuredClone(recipe));
    expect(normalized).toEqual(recipe);
    expect(normalized?.curve.pointsByChannel).toEqual(recipe.curve.pointsByChannel);
    expect(normalized?.curve.parametric).toEqual(recipe.curve.parametric);

    const cloned = cloneCameraRawRecipe(recipe);
    cloned.curve.pointsByChannel[0][1].y = 0.2;
    expect(recipe.curve.pointsByChannel[0][1].y).toBe(0.55);
  });

  it("keeps the fixed render prefix stable and round-trips editable curve authoring", () => {
    const recipe = defaultRecipe();
    const before = recipeToParams(recipe);
    recipe.curve.pointsByChannel[0] = [{ x: 0, y: 0 }, { x: 0.5, y: 0.75 }, { x: 1, y: 1 }];
    recipe.curve.parametric = { highlights: 50, lights: 25, darks: -25, shadows: -50 };
    const encoded = recipeToParams(recipe);
    expect(encoded.slice(0, CAMERA_RAW_PARAMS_LEN)).toEqual(before);
    expect(encoded.length).toBeGreaterThan(CAMERA_RAW_PARAMS_LEN);
    const decoded = paramsToRecipe(encoded);
    expect(decoded.curve.pointsByChannel).toEqual(recipe.curve.pointsByChannel);
    expect(decoded.curve.parametric).toEqual(recipe.curve.parametric);
  });

  it("preserves every collection entry at the fid-17 limits and rejects overflow", () => {
    const recipe = defaultRecipe();
    recipe.healSpots = Array.from({ length: MAX_CAMERA_RAW_HEAL_SPOTS }, (_, index) => ({
      id: `heal-${index}`, mode: "heal" as const, x: 0.5, y: 0.5,
      sourceX: 0.25, sourceY: 0.25, radius: 0.125, feather: 0.5, opacity: 1,
    }));
    const points = Array.from({ length: MAX_CAMERA_RAW_MASK_POINTS }, () => ({ x: 0.5, y: 0.5, pressure: 1 }));
    recipe.masks = Array.from({ length: MAX_CAMERA_RAW_MASKS }, (_, index) => ({
      id: `mask-${index}`, name: `Mask ${index}`, kind: "brush" as const,
      enabled: true, inverted: false, opacity: 1, feather: 0.5,
      points: index === 0 ? points : [],
      ...(index === 0 ? {
        colorSamples: Array.from({ length: MAX_CAMERA_RAW_MASK_COLORS }, () => [16, 32, 64] as [number, number, number]),
      } : {}),
      adjustments: defaultCameraRawLocalAdjustments(),
    }));

    const decoded = paramsToRecipe(recipeToParams(recipe));
    expect(decoded.healSpots).toHaveLength(MAX_CAMERA_RAW_HEAL_SPOTS);
    expect(decoded.masks).toHaveLength(MAX_CAMERA_RAW_MASKS);
    expect(decoded.masks.reduce((total, mask) => total + mask.points.length, 0)).toBe(MAX_CAMERA_RAW_MASK_POINTS);
    expect(decoded.masks[0].colorSamples).toHaveLength(MAX_CAMERA_RAW_MASK_COLORS);

    const tooManyHeals = { ...defaultRecipe(), healSpots: [...recipe.healSpots, recipe.healSpots[0]] };
    const tooManyMasks = { ...defaultRecipe(), masks: [...recipe.masks, recipe.masks[0]] };
    const tooManyMaskPoints = defaultRecipe();
    tooManyMaskPoints.masks = [{ ...recipe.masks[0], points: [...points, points[0]] }];
    const tooManyColors = defaultRecipe();
    tooManyColors.masks = [{
      ...recipe.masks[0], points: [],
      colorSamples: [...recipe.masks[0].colorSamples!, recipe.masks[0].colorSamples![0]],
    }];
    for (const oversized of [tooManyHeals, tooManyMasks, tooManyMaskPoints, tooManyColors]) {
      expect(normalizeCameraRawRecipe(oversized)).toBeNull();
      expect(() => recipeToParams(oversized)).toThrow("Invalid Camera Raw recipe");
    }
  });

  it("upgrades a legacy recipe and supplies neutral v2 defaults", () => {
    const legacy = defaultRecipe() as CameraRawRecipe & Record<string, unknown>;
    delete legacy.schemaVersion;
    delete legacy.profile;
    delete legacy.calibration;
    delete legacy.crop;
    delete legacy.healSpots;
    delete legacy.masks;
    delete legacy.enhance;
    delete legacy.curve.pointsByChannel;
    delete legacy.curve.parametric;
    legacy.basic.exposure = 0.75;

    const normalized = normalizeCameraRawRecipe(legacy);
    expect(normalized?.schemaVersion).toBe(CAMERA_RAW_RECIPE_VERSION);
    expect(normalized?.basic.exposure).toBe(0.75);
    expect(normalized?.profile.id).toBe("camera-default");
    expect(normalized?.curve.pointsByChannel).toHaveLength(4);
    expect(normalized?.curve.parametric).toEqual({ highlights: 0, lights: 0, darks: 0, shadows: 0 });
  });

  it("rejects future/oversized structures and clamps untrusted scalar values", () => {
    expect(normalizeCameraRawRecipe({ ...defaultRecipe(), schemaVersion: 99 })).toBeNull();
    expect(normalizeCameraRawRecipe({ ...defaultRecipe(), schemaVersion: 1.5 })).toBeNull();
    expect(normalizeCameraRawRecipe({ ...defaultRecipe(), masks: Array(MAX_CAMERA_RAW_MASKS + 1).fill({}) })).toBeNull();
    const tooManyPoints = defaultRecipe();
    tooManyPoints.curve.pointsByChannel[0] = Array.from(
      { length: MAX_CAMERA_RAW_CURVE_POINTS_PER_CHANNEL + 1 },
      (_, i) => ({ x: i, y: i }),
    );
    expect(normalizeCameraRawRecipe(tooManyPoints)).toBeNull();

    const malformed = defaultRecipe();
    malformed.basic.exposure = Number.POSITIVE_INFINITY;
    malformed.detail.sharpenRadius = 1_000_000;
    malformed.crop.x = 2;
    malformed.crop.angle = -100;
    malformed.profile.amount = 3;
    const normalized = normalizeCameraRawRecipe(malformed);
    expect(normalized?.basic.exposure).toBe(0);
    expect(normalized?.detail.sharpenRadius).toBe(3);
    expect(normalized?.crop.x).toBe(1);
    expect(normalized?.crop.angle).toBe(-45);
    expect(normalized?.profile.amount).toBe(1);
  });

  it("defensively clones original bytes and sanitizes RAW provenance", () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const source = {
      version: CAMERA_RAW_SOURCE_VERSION,
      originalName: "  frame.nef\u0000 ",
      originalPath: "/photos/frame.nef",
      mimeType: "image/x-nikon-nef",
      sha256: "A".repeat(64),
      lastModified: 1234,
      originalBytes: bytes,
      metadata: { make: "Nikon", width: 8256, extra: { Rating: 5, bad: { nested: true } } },
      recipe: defaultRecipe(),
    };
    const normalized = normalizeCameraRawSource(source);
    expect(normalized?.originalName).toBe("frame.nef");
    expect(normalized?.sha256).toBe("a".repeat(64));
    expect(normalized?.metadata.extra).toEqual({ Rating: 5 });
    bytes[0] = 99;
    expect(normalized?.originalBytes[0]).toBe(1);

    const ownedBytes = new Uint8Array([5, 6, 7]);
    const adopted = normalizeCameraRawSource({ ...source, originalBytes: ownedBytes }, { copyBytes: false });
    expect(adopted?.originalBytes).toBe(ownedBytes);

    const clone = cloneCameraRawSource(normalized!);
    clone.originalBytes[1] = 88;
    expect(normalized?.originalBytes[1]).toBe(2);
    expect(normalizeCameraRawSource({ ...source, version: 2 })).toBeNull();
    expect(normalizeCameraRawSource({ ...source, originalBytes: new Uint8Array() })).toBeNull();

    // Override only the reported length/slice so this boundary test does not
    // allocate and then clone a 256 MiB fixture.
    const reportedBytes = (length: number): Uint8Array => {
      const value = new Uint8Array([1]);
      Object.defineProperty(value, "length", { value: length });
      Object.defineProperty(value, "slice", { value: () => new Uint8Array([1]) });
      return value;
    };
    expect(MAX_CAMERA_RAW_SOURCE_BYTES).toBe(256 * 1024 * 1024);
    expect(normalizeCameraRawSource({ ...source, originalBytes: reportedBytes(MAX_CAMERA_RAW_SOURCE_BYTES) })).not.toBeNull();
    expect(normalizeCameraRawSource({ ...source, originalBytes: reportedBytes(MAX_CAMERA_RAW_SOURCE_BYTES + 1) })).toBeNull();
  });

  it("bridges decoded engine metadata into the canonical persisted schema", () => {
    const metadata = normalizeCameraRawSourceMetadata({
      make: "Acme", model: "Sensor One", cleanMake: "Acme", cleanModel: "One",
      lens: "Standard Zoom", focalLengthMm: 50, aperture: 2.8, focalLength35Mm: 75, subjectDistanceM: 3,
      sourceWidth: 8256, sourceHeight: 5504, outputWidth: 8240, outputHeight: 5492,
      cpp: 1, sampleFormat: "integer", cfaPattern: "RGGB", orientation: 6,
      blackLevels: [64, 65, 66, 67], whiteLevels: [16383, 16383, 16383, 16383],
      wbCoefficients: [2, 1, 1.5, 1],
      xyzToCamera: [[0.5, 0.25, 0.125], [0.125, 0.75, 0.125], [0.1, 0.2, 0.7], [0, 0, 0]],
      cameraToXyz: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]],
    });
    expect(metadata).toMatchObject({
      make: "Acme", model: "Sensor One", width: 8240, height: 5492,
      lens: "Standard Zoom", focalLengthMm: 50, aperture: 2.8, focalLength35Mm: 75, subjectDistanceM: 3,
      cfaPattern: "RGGB", orientation: 6,
      whiteBalance: [2, 1, 1.5, 1],
      blackLevels: [64, 65, 66, 67],
      extra: { sourceWidth: 8256, sourceHeight: 5504, samplesPerPixel: 1, sampleFormat: "integer" },
    });
    expect(metadata.colorMatrix1).toHaveLength(12);
    expect(metadata.colorMatrix2).toHaveLength(12);
    expect(normalizeCameraRawSourceMetadata({ focalLength35Mm: 0, subjectDistanceM: Number.NaN })).toEqual({});
    expect(normalizeCameraRawSourceMetadata({ focalLength35Mm: 1e9, subjectDistanceM: 1e12 }))
      .toEqual({ focalLength35Mm: 65535, subjectDistanceM: 1e9 });
  });

  it("stops flattening nested metadata as soon as its canonical bound is crossed", () => {
    const oversized = new Proxy(new Array(1_000_000).fill(1), {
      get(target, property, receiver) {
        const index = typeof property === "string" && /^\d+$/.test(property) ? Number(property) : -1;
        if (index > 12) throw new Error("metadata normalizer read past its bound");
        return Reflect.get(target, property, receiver);
      },
    });
    expect(() => normalizeCameraRawSourceMetadata({ colorMatrix1: [oversized] })).not.toThrow();
    expect(normalizeCameraRawSourceMetadata({ colorMatrix1: [oversized] }).colorMatrix1).toBeUndefined();
  });
});

describe("parametricCurvePoints", () => {
  it("neutral sliders give the identity diagonal", () => {
    const pts = parametricCurvePoints({ highlights: 0, lights: 0, darks: 0, shadows: 0 });
    for (const p of pts) expect(p.y).toBeCloseTo(p.x, 6);
  });

  it("is monotone with pinned endpoints for arbitrary region sliders", () => {
    for (const s of [{ highlights: 80, lights: -40, darks: 60, shadows: -90 },
      { highlights: -100, lights: 100, darks: -100, shadows: 100 }]) {
      const pts = parametricCurvePoints(s);
      expect(pts[0]).toEqual({ x: 0, y: 0 });
      expect(pts[pts.length - 1]).toEqual({ x: 1, y: 1 });
      for (let i = 1; i < pts.length; i++) expect(pts[i].y).toBeGreaterThanOrEqual(pts[i - 1].y);
      // The compiled LUT is likewise non-decreasing (a valid tone map).
      const lut = buildLut(pts);
      for (let i = 1; i < 256; i++) expect(lut[i]).toBeGreaterThanOrEqual(lut[i - 1]);
    }
  });
});

describe("compileCurveLuts", () => {
  it("identity points + neutral parametric compile to identity LUTs", () => {
    const diag = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    const luts = compileCurveLuts([diag, diag, diag, diag], { highlights: 0, lights: 0, darks: 0, shadows: 0 });
    for (const ch of [luts.master, luts.r, luts.g, luts.b]) {
      for (let i = 0; i < 256; i++) expect(ch[i]).toBe(i);
    }
  });
});

describe("clippingCounts", () => {
  it("counts highlight-clipped (any channel 255) and shadow-clipped (any 0) pixels", () => {
    // 4 pixels: white (hi), black (sh), mid (neither), mixed 255+0 (both).
    const rgba = new Uint8ClampedArray([
      255, 255, 255, 255,
      0, 0, 0, 255,
      128, 128, 128, 255,
      255, 0, 128, 255,
    ]);
    expect(clippingCounts(rgba)).toEqual({ shadow: 2, highlight: 2 });
  });

  it("a flat mid-grey buffer clips nothing", () => {
    const rgba = new Uint8ClampedArray(40).fill(128);
    for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255; // opaque alpha, ignored
    expect(clippingCounts(rgba)).toEqual({ shadow: 0, highlight: 0 });
  });
});

describe("autoWhiteBalance", () => {
  const fill = (r: number, g: number, b: number, px = 4): Uint8ClampedArray => {
    const out = new Uint8ClampedArray(px * 4);
    for (let i = 0; i < px; i++) { out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b; out[i * 4 + 3] = 255; }
    return out;
  };

  it("a neutral grey buffer needs no correction", () => {
    expect(autoWhiteBalance(fill(128, 128, 128))).toEqual({ temp: 0, tint: 0 });
  });

  it("cools a warm (red>blue) cast and the correction neutralises red≈blue", () => {
    // A mild cast so temp stays inside [-1, 1] (an extreme cast clamps and can't
    // fully equalise). Applying the engine's temp gain then equalises R and B.
    const { temp, tint } = autoWhiteBalance(fill(150, 128, 120));
    expect(temp).toBeLessThan(0); // warm → cool it
    expect(temp).toBeGreaterThan(-1); // not clamped
    expect(150 * (1 + temp * 0.3)).toBeCloseTo(120 * (1 - temp * 0.3), 1);
    expect(tint).toBeGreaterThan(0); // green below red/blue mean → add green
  });

  it("removes a green cast with a negative tint", () => {
    const { tint } = autoWhiteBalance(fill(120, 190, 120));
    expect(tint).toBeLessThan(0); // green-heavy → pull green down
  });

  it("an empty buffer is a no-op", () => {
    expect(autoWhiteBalance(new Uint8ClampedArray(0))).toEqual({ temp: 0, tint: 0 });
  });
});

describe("proxyMaxDim", () => {
  it("caps the long edge at 2200 and scales by dpr", () => {
    expect(proxyMaxDim(800, 600, 1)).toBe(800);
    expect(proxyMaxDim(800, 600, 2)).toBe(1600);
    expect(proxyMaxDim(4000, 3000, 2)).toBe(2200); // capped
    expect(proxyMaxDim(0, 0, 1)).toBe(1); // never zero
  });
});

// Keep a stable reference to the recipe type for future extension.
export type _RecipeShape = CameraRawRecipe;
