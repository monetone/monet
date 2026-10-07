// GAL-DEV-12 preset library logic: the built-in patches must normalize into
// real (non-neutral, current-version) recipes, the Amount slider must scale a
// look toward/past neutral without ever interpolating version fields or the
// geometry applyPresetRecipe preserves, and "Folder/Name" must file a user
// preset under its folder.

import { createDefaultRecipe, normalizeRecipe } from "@monet-ui/monet-photo";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({ readFile: vi.fn(), writeTextFile: vi.fn() }));
vi.mock("../catalog/catalog", () => ({
  addPreset: vi.fn(),
  catalogAvailable: () => false,
  deletePreset: vi.fn(),
  listPresets: vi.fn(),
}));
vi.mock("../state/store", () => ({ store: { notify: vi.fn() } }));

import { BUILTIN_PRESET_GROUPS, scalePresetRecipe, splitPresetName } from "./PresetsPanel";

describe("BUILTIN_PRESET_GROUPS", () => {
  it("ships groups and every patch normalizes to a non-neutral current recipe", () => {
    expect(BUILTIN_PRESET_GROUPS.length).toBeGreaterThanOrEqual(3);
    const neutral = JSON.stringify(createDefaultRecipe());
    for (const g of BUILTIN_PRESET_GROUPS) {
      expect(g.presets.length).toBeGreaterThan(0);
      for (const p of g.presets) {
        const r = normalizeRecipe(p.patch);
        // normalizeRecipe returns the plain default for a rejected patch, so
        // differing from neutral proves the patch actually landed.
        expect(JSON.stringify(r), `${g.group}/${p.name}`).not.toBe(neutral);
        expect(r.version).toBe(createDefaultRecipe().version);
      }
    }
  });

  it("B&W presets switch the color mixer to bw", () => {
    const bw = BUILTIN_PRESET_GROUPS.find((g) => g.group === "Monet B&W")!;
    for (const p of bw.presets) expect(normalizeRecipe(p.patch).colorMixer.mode).toBe("bw");
  });
});

describe("scalePresetRecipe", () => {
  const preset = () => {
    const r = createDefaultRecipe();
    return {
      ...r,
      crop: { ...r.crop, rect: { top: 0.1, left: 0.1, bottom: 0.9, right: 0.9 } },
      basic: { ...r.basic, exposure: 1, contrast: 25 },
      detail: { ...r.detail, sharpenAmount: 80 },
    };
  };

  it("100% is the preset unchanged", () => {
    const p = preset();
    expect(scalePresetRecipe(p, 100)).toEqual(p);
  });

  it("50% halves the look", () => {
    const out = scalePresetRecipe(preset(), 50);
    expect(out.basic.exposure).toBeCloseTo(0.5, 6);
    expect(out.basic.contrast).toBeCloseTo(12.5, 6);
    const d = createDefaultRecipe().detail.sharpenAmount;
    expect(out.detail.sharpenAmount).toBeCloseTo(d + (80 - d) / 2, 6);
  });

  it("0% is a neutral look", () => {
    const out = scalePresetRecipe(preset(), 0);
    expect(out.basic.exposure).toBeCloseTo(0, 6);
    expect(out.basic.contrast).toBeCloseTo(0, 6);
  });

  it("200% extrapolates the look", () => {
    const out = scalePresetRecipe(preset(), 200);
    expect(out.basic.contrast).toBeCloseTo(50, 6);
  });

  it("never interpolates version fields or preserved geometry", () => {
    const p = preset();
    const out = scalePresetRecipe(p, 50);
    expect(out.version).toBe(p.version);
    expect(out.processVersion).toBe(p.processVersion);
    expect(out.crop.rect).toEqual(p.crop.rect);
  });

  it("non-numeric switches snap to the preset once amount > 0", () => {
    const p = { ...createDefaultRecipe() };
    p.colorMixer = { ...p.colorMixer, mode: "bw" };
    expect(scalePresetRecipe(p, 50).colorMixer.mode).toBe("bw");
    expect(scalePresetRecipe(p, 0).colorMixer.mode).toBe(createDefaultRecipe().colorMixer.mode);
  });
});

describe("splitPresetName", () => {
  it("files Folder/Name under its folder", () => {
    expect(splitPresetName("Portraits/Soft Skin")).toEqual({ group: "Portraits", leaf: "Soft Skin" });
  });

  it("bare names go to User Presets; degenerate slashes stay whole", () => {
    expect(splitPresetName("Punchy")).toEqual({ group: "User Presets", leaf: "Punchy" });
    expect(splitPresetName("/x")).toEqual({ group: "User Presets", leaf: "/x" });
    expect(splitPresetName("x/")).toEqual({ group: "User Presets", leaf: "x/" });
  });
});
