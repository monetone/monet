// Unit tests for the Camera Raw develop-preset helpers (engine-free, node). The
// workspace apply path (seed recipe state) is covered by e2e.
import { describe, it, expect } from "vitest";
import { CAMERA_RAW_PARAMS_LEN, defaultRecipe, recipeToParams } from "./cameraRaw";
import { normalizeWorkingRecipe, workingRecipeToParams, type VisionDevelopRecipe } from "./visionDevelopRecipe";
import {
  DEFAULT_CAMERA_RAW_PRESETS,
  addCameraRawPresetTo,
  defaultCameraRawPresetName,
  parseCameraRawPresets,
  removeCameraRawPresetAt,
  saveCameraRawPresets,
  type CameraRawPreset,
} from "./cameraRawPresets";

describe("DEFAULT_CAMERA_RAW_PRESETS", () => {
  it("are complete, serialisable recipes with distinct non-neutral looks", () => {
    expect(DEFAULT_CAMERA_RAW_PRESETS.length).toBeGreaterThanOrEqual(4);
    const neutral = recipeToParams(defaultRecipe());
    const names = new Set<string>();
    for (const p of DEFAULT_CAMERA_RAW_PRESETS) {
      expect(names.has(p.name)).toBe(false); // unique names
      names.add(p.name);
      // Each preset is a full working recipe → serialises to the exact param length…
      const params = workingRecipeToParams(p.recipe);
      expect(params.length).toBe(CAMERA_RAW_PARAMS_LEN);
      // …and actually differs from the neutral recipe (it does something).
      expect(Array.from(params).some((v, i) => v !== neutral[i])).toBe(true);
    }
  });

  it("applies an OLD Canonical-shaped saved preset to byte-identical engine params (invariant #2)", () => {
    // A pre-flip saved preset library stored the Canonical recipe shape verbatim.
    const canonical = defaultRecipe();
    canonical.basic.contrast = 0.3;
    canonical.grade.highlights = { hue: 40, sat: 0.25 };
    const lib = parseCameraRawPresets(JSON.stringify([{ name: "Old", recipe: canonical }]))!;
    // The workspace applies a preset via normalizeWorkingRecipe (migrates Canonical).
    expect(Array.from(workingRecipeToParams(normalizeWorkingRecipe(lib[0].recipe))))
      .toEqual(Array.from(recipeToParams(canonical)));
  });
});

describe("defaultCameraRawPresetName", () => {
  it("returns one past the highest 'Preset N', ignoring other names", () => {
    expect(defaultCameraRawPresetName([])).toBe("Preset 1");
    expect(defaultCameraRawPresetName(["Preset 1", "Warm Portrait", "Preset 3"])).toBe("Preset 4");
    expect(defaultCameraRawPresetName(["My Look", "Punchy"])).toBe("Preset 1");
  });
});

describe("addCameraRawPresetTo / removeCameraRawPresetAt", () => {
  const mk = (name: string): CameraRawPreset => ({ name, recipe: {} as VisionDevelopRecipe });

  it("appends a new name and replaces an existing one in place", () => {
    const a = addCameraRawPresetTo([], mk("A"));
    expect(a.map((p) => p.name)).toEqual(["A"]);
    const b = addCameraRawPresetTo(a, mk("B"));
    expect(b.map((p) => p.name)).toEqual(["A", "B"]);
    // Saving over "A" replaces its slot (no duplicate, order preserved).
    const replaced = addCameraRawPresetTo(b, { name: "A", recipe: { tag: 1 } as unknown as VisionDevelopRecipe });
    expect(replaced.map((p) => p.name)).toEqual(["A", "B"]);
    expect((replaced[0].recipe as unknown as { tag: number }).tag).toBe(1);
  });

  it("removes by index and no-ops out of range (same ref)", () => {
    const list = [mk("A"), mk("B")];
    expect(removeCameraRawPresetAt(list, 0).map((p) => p.name)).toEqual(["B"]);
    expect(removeCameraRawPresetAt(list, 5)).toBe(list);
    expect(removeCameraRawPresetAt(list, -1)).toBe(list);
  });
});

describe("parseCameraRawPresets", () => {
  it("accepts a well-formed library and rejects junk", () => {
    const good = JSON.stringify([{ name: "L", recipe: { basic: {} } }]);
    expect(parseCameraRawPresets(good)?.[0].name).toBe("L");
    expect(parseCameraRawPresets(null)).toBeNull();
    expect(parseCameraRawPresets("")).toBeNull();
    expect(parseCameraRawPresets("[]")).toBeNull();
    expect(parseCameraRawPresets("not json")).toBeNull();
    expect(parseCameraRawPresets(JSON.stringify([{ name: "x" }]))).toBeNull(); // no recipe
    expect(parseCameraRawPresets(JSON.stringify([{ recipe: {} }]))).toBeNull(); // no name
  });
});

describe("Camera Raw preset persistence", () => {
  it("reports a rejected write", () => {
    (globalThis as { localStorage?: Storage }).localStorage = {
      setItem: () => { throw new DOMException("quota", "QuotaExceededError"); },
    } as unknown as Storage;

    expect(saveCameraRawPresets([])).toBe(false);
  });
});
