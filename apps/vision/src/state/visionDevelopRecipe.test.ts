// Byte-exact round-trip proof for the V2 engine-boundary seam (docs/plans/10
// Phase 5(d2a)). workingRecipeToParams(engineParamsToWorkingRecipe(p)) must
// reproduce p BYTE-FOR-BYTE for two inputs:
//   (a) the crafted non-identity-LUT prefix array from cameraRaw.test.ts, and
//   (b) the MAXIMAL params of the frozen ABI golden (every advanced panel).
// It also proves the read-back exposes the expected V2 panels AND re-synthesizes
// Vision's stable ids/names — the two things a real state migration depends on.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  engineParamsToWorkingRecipe,
  normalizeWorkingRecipe,
  workingRecipeToParams,
} from "./visionDevelopRecipe";
import { CAMERA_RAW_PARAMS_LEN, CAMERA_RAW_VERSION, defaultRecipe } from "./cameraRaw";

const CURVE_BASE = 26;
const rt = (p: ArrayLike<number>): number[] =>
  Array.from(workingRecipeToParams(engineParamsToWorkingRecipe(p)));

/** The exact crafted array from cameraRaw.test.ts: distinct f32-safe scalars at
 *  every prefix offset + a non-identity curve. Prefix-only (no advanced tail). */
function craftedParams(): Float32Array {
  const src = new Float32Array(CAMERA_RAW_PARAMS_LEN);
  src[0] = CAMERA_RAW_VERSION;
  src[1] = 1;
  for (let i = 2; i <= 25; i++) src[i] = (i - 12) / 8;
  src[25] = 1; // curve enabled
  for (let ch = 0; ch < 4; ch++) {
    for (let i = 0; i < 256; i++) src[CURVE_BASE + ch * 256 + i] = (i + ch * 7) & 255;
  }
  return src;
}

// The frozen ABI golden IS a maximal recipe's params (v3 tail: profile,
// calibration, crop, enhance, 2 heals, 2 masks, 2 point colours, authored curve).
const goldenParams: number[] = (JSON.parse(
  readFileSync(fileURLToPath(new URL("./__fixtures__/cameraRaw-abi-golden.json", import.meta.url)), "utf8"),
) as { params: number[] }).params;

describe("Vision develop-recipe V2 seam — byte-exact round-trip", () => {
  it("(a) reproduces the crafted non-identity-LUT prefix array byte-for-byte", () => {
    const src = craftedParams();
    expect(rt(src)).toEqual(Array.from(src));
  });

  it("(b) reproduces the MAXIMAL ABI-golden params byte-for-byte", () => {
    expect(rt(goldenParams)).toEqual(goldenParams);
  });
});

describe("Vision develop-recipe V2 seam — read-back exposes V2 panels", () => {
  const working = engineParamsToWorkingRecipe(goldenParams);

  it("exposes the migrated V2 colour panels (colorMixer/colorGrading/transform)", () => {
    expect(working.colorMixer.hue).toHaveLength(8);
    expect(working.colorMixer.hue.some((v) => v !== 0)).toBe(true);
    expect(working.colorMixer.saturation.some((v) => v !== 0)).toBe(true);
    expect(working.colorMixer.luminance.some((v) => v !== 0)).toBe(true);
    // Grade shadows.hue = 210, transform.vertical = 0.125 in the golden recipe.
    expect(working.colorGrading.shadows.hue).toBe(210);
    expect(working.transform.vertical).toBe(0.125);
  });

  it("carries Vision's decoupled render LUTs as toneCurve.compiledLuts", () => {
    const luts = working.toneCurve.compiledLuts;
    expect(luts).toBeDefined();
    expect(luts!.master).toHaveLength(256);
    expect(luts!.r).toHaveLength(256);
    expect(luts!.g).toHaveLength(256);
    expect(luts!.b).toHaveLength(256);
  });
});

describe("Vision develop-recipe V2 seam — synthesizes Vision's stable ids/names", () => {
  const working = engineParamsToWorkingRecipe(goldenParams);

  it("re-synthesizes heal ids on the same scheme as paramsToRecipe (heal-N)", () => {
    expect(working.heal.spots).toHaveLength(2);
    expect(working.heal.spots.map((s) => s.id)).toEqual(["heal-1", "heal-2"]);
  });

  it("re-synthesizes mask ids AND display names (mask-N / '<kind> N')", () => {
    expect(working.engineMasks).toHaveLength(2);
    expect(working.engineMasks!.map((m) => m.id)).toEqual(["mask-1", "mask-2"]);
    // paramsToRecipe names a mask `${kind.replace(/-/g," ")} ${i+1}`.
    expect(working.engineMasks!.map((m) => m.name)).toEqual(["brush 1", "outline 2"]);
  });

  it("re-synthesizes point-color ids on the same scheme (point-color-N)", () => {
    expect(working.pointColor.samples).toHaveLength(2);
    expect(working.pointColor.samples.map((s) => s.id)).toEqual(["point-color-1", "point-color-2"]);
  });
});

// The Canonical branch of the trust boundary (#159): sidecars, MCP JSON and
// persisted presets all arrive here, so a partial/hostile Canonical object must
// come back as a filled, clamped recipe — never a TypeError, never a NaN float.
describe("normalizeWorkingRecipe — hostile Canonical input", () => {
  const defaults = Array.from(workingRecipeToParams(normalizeWorkingRecipe(defaultRecipe())));

  it.each([
    ["bare grade", { grade: {} }],
    ["grade + empty basic", { grade: {}, basic: {} }],
    ["grade + empty mask", { grade: {}, masks: [{}] }],
    ["grade + empty heal spot", { grade: {}, healSpots: [{}] }],
    ["grade + empty point colour", { grade: {}, pointColors: [{}] }],
  ])("fills a NaN-free ABI for %s instead of throwing", (_name, input) => {
    const params = Array.from(workingRecipeToParams(normalizeWorkingRecipe(input)));
    expect(params.length).toBeGreaterThanOrEqual(defaults.length);
    expect(params.some((v) => Number.isNaN(v))).toBe(false);
  });

  it("fills the scalar panels with the same defaults a full default recipe yields", () => {
    expect(Array.from(workingRecipeToParams(normalizeWorkingRecipe({ grade: {} })))).toEqual(defaults);
  });

  it("keeps the fields a partial Canonical recipe DOES carry", () => {
    const r = normalizeWorkingRecipe({ grade: { shadows: { hue: 210, sat: 0.4 } } });
    expect(r.colorGrading.shadows.hue).toBe(210);
    expect(r.colorGrading.shadows.sat).toBe(0.4);
  });

  it("clamps wrong-typed / out-of-range scalars instead of writing them to the ABI", () => {
    const r = normalizeWorkingRecipe({ grade: {}, basic: { exposure: "abc", contrast: 999 } });
    expect(r.basic.exposure).toBe(0);
    expect(r.basic.contrast).toBe(1);
    expect(Array.from(workingRecipeToParams(r)).some((v) => Number.isNaN(v))).toBe(false);
  });
});
