// Frozen ABI golden for the Camera Raw recipe→params wire format.
//
// Phase 5 of the monet-photo refactor (docs/plans/10) unifies this codec onto
// DevelopRecipeV2; this golden is the byte-for-byte contract the new impl must
// reproduce. The round-trip tests in cameraRaw.test.ts can NOT catch a wire
// drift where encode and decode change together — an external frozen golden
// can. Captured before the refactor, on the current (pre-Phase-5) codec.
//
// Regenerate deliberately (only when a wire change is intended, then re-bless
// against the Rust side too — see plan §5/§6):
//   CAPTURE_ABI_GOLDEN=1 pnpm --filter monet-vision exec vitest run src/state/cameraRaw.abi.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import {
  defaultRecipe,
  defaultCameraRawLocalAdjustments,
  recipeToParams,
  paramsToRecipe,
  CAMERA_RAW_PARAMS_LEN,
  CAMERA_RAW_ADVANCED_MAGIC,
  CAMERA_RAW_ADVANCED_V3,
  type CameraRawRecipe,
} from "./cameraRaw";

const GOLDEN_URL = new URL("./__fixtures__/cameraRaw-abi-golden.json", import.meta.url);

/** A recipe that populates EVERY advanced-tail region — pointColors present, so
 *  the encoder emits the widest (v3) tail — plus non-trivial curve authoring.
 *  Values pass through the same Float32 quantization on capture and on assert,
 *  so the golden is byte-stable regardless of exact representability. */
export function buildAbiGoldenRecipe(): CameraRawRecipe {
  const r = defaultRecipe();
  r.basic = {
    temp: 0.25, tint: -0.125, exposure: 0.5, contrast: -0.25,
    highlights: -0.5, shadows: 0.75, whites: 0.25, blacks: -0.125,
    texture: 0.375, clarity: -0.25, dehaze: 0.125, vibrance: 0.5, saturation: -0.375,
  };
  r.detail = { sharpenAmount: 0.5, sharpenRadius: 2, nrStrength: 0.25, nrColor: 0.5, nrDetail: 0.75 };
  r.effects = { grainAmount: 0.25, grainHighlight: 0.5, grainIntensity: 0.375, vignetteAmount: -0.5, vignetteMidpoint: 0.25 };
  r.optics = { distortion: 0.125, aberration: -0.25, defringe: 0.5 };
  r.hsl = {
    hue: [0.5, -0.25, 0.125, -0.5, 0.25, -0.125, 0.375, -0.375],
    sat: [-0.5, 0.25, -0.125, 0.5, -0.25, 0.125, -0.375, 0.375],
    lum: [0.25, -0.5, 0.375, -0.125, 0.5, -0.25, 0.125, -0.375],
  };
  r.grade = { shadows: { hue: 210, sat: 0.4 }, midtones: { hue: 40, sat: 0.2 }, highlights: { hue: 90, sat: 0.6 } };
  r.geometry = { vertical: 0.125, horizontal: -0.25, rotate: 0.5 };
  r.profile = { id: "adobe-color", name: "Adobe Color", kind: "creative", amount: 0.75 };
  r.calibration = {
    shadowTint: -0.25,
    red: { hue: 0.5, saturation: 0.25 },
    green: { hue: -0.5, saturation: 0.125 },
    blue: { hue: 0.25, saturation: -0.25 },
  };
  r.crop = {
    enabled: true, x: 0.125, y: 0.25, width: 0.75, height: 0.5, angle: 2,
    constrainAspect: true, aspectRatio: 1.5, flipHorizontal: true, flipVertical: false,
  };
  r.healSpots = [
    { id: "dust", mode: "clone", x: 0.5, y: 0.25, sourceX: 0.375, sourceY: 0.25, radius: 0.0625, feather: 0.5, opacity: 0.75 },
    { id: "heal", mode: "heal", x: 0.75, y: 0.5, sourceX: 0.625, sourceY: 0.5, radius: 0.03125, feather: 0.25, opacity: 1 },
  ];
  r.masks = [
    {
      id: "mask", name: "Mask", kind: "brush", enabled: true, inverted: true,
      opacity: 0.75, feather: 0.25, range: [0.125, 0.875],
      points: [{ x: 0.25, y: 0.5, pressure: 0.75 }],
      colorSamples: [[16, 32, 64]],
      adjustments: { ...defaultCameraRawLocalAdjustments(), exposure: 0.5, texture: -0.25 },
    },
    {
      id: "ai", name: "AI subject", kind: "outline", enabled: true, inverted: false,
      opacity: 1, feather: 0.5, range: [0, 1],
      points: [
        { x: 0.25, y: 0.25, pressure: 1 }, { x: 0.75, y: 0.25, pressure: 1 },
        { x: 0.75, y: 0.875, pressure: 1 }, { x: 0.25, y: 0.875, pressure: 1 },
      ],
      colorSamples: [],
      adjustments: { ...defaultCameraRawLocalAdjustments(), exposure: -0.25 },
    },
  ];
  r.pointColors = [
    { id: "pc1", refHue: 120, refSat: 0.5, refLum: 0.5, hue: 0.25, sat: -0.5, lum: 0.125, range: 0.5 },
    { id: "pc2", refHue: 300, refSat: 0.75, refLum: 0.25, hue: -0.125, sat: 0.375, lum: -0.25, range: 0.75 },
  ];
  r.enhance = { denoise: true, denoiseAmount: 0.5, rawDetails: true, superResolution: true };
  r.curve = {
    ...r.curve,
    enabled: true,
    pointsByChannel: [
      [{ x: 0, y: 0 }, { x: 0.25, y: 0.375 }, { x: 0.75, y: 0.625 }, { x: 1, y: 1 }],
      [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      [{ x: 0, y: 0 }, { x: 0.5, y: 0.5625 }, { x: 1, y: 1 }],
      [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    ],
    parametric: { highlights: 25, lights: -12, darks: 12, shadows: -25 },
  };
  return r;
}

describe("Camera Raw ABI golden (frozen wire format)", () => {
  const params = Array.from(recipeToParams(buildAbiGoldenRecipe(), 1));

  if (process.env.CAPTURE_ABI_GOLDEN) {
    it("captures the golden fixture", () => {
      const path = fileURLToPath(GOLDEN_URL);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify({
        note: "Frozen recipe→params wire format (monet-photo plan §5). Do NOT hand-edit; regenerate with CAPTURE_ABI_GOLDEN=1.",
        paramsLength: params.length,
        params,
      }) + "\n");
      expect(params.length).toBeGreaterThan(CAMERA_RAW_PARAMS_LEN);
    });
    return;
  }

  const golden = JSON.parse(readFileSync(fileURLToPath(GOLDEN_URL), "utf8")) as {
    paramsLength: number; params: number[];
  };

  it("emits the widest (v3) tail — magic + version intact", () => {
    expect(params[CAMERA_RAW_PARAMS_LEN]).toBe(CAMERA_RAW_ADVANCED_MAGIC);
    expect(params[CAMERA_RAW_PARAMS_LEN + 1]).toBe(CAMERA_RAW_ADVANCED_V3);
  });

  it("reproduces the frozen golden byte-for-byte", () => {
    expect(params.length).toBe(golden.paramsLength);
    expect(params).toEqual(golden.params);
  });

  it("golden decodes and re-encodes to itself (round-trip stable)", () => {
    const back = Array.from(recipeToParams(paramsToRecipe(Float32Array.from(golden.params))));
    expect(back).toEqual(golden.params);
  });
});
