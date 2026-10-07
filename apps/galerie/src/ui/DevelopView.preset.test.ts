// Applying a develop preset must not wipe the photo's own work. A preset is
// stored as a whole canonical recipe, so a naive setRecipe(preset) threw away
// the crop, heal spots, masks and the capture white balance — silent data loss.
// applyPresetRecipe overlays only the look panels; this pins both halves (what
// carries over, what survives).

import { createDefaultRecipe, type DevelopRecipeV2 } from "@monet-ui/monet-photo";
import { describe, expect, it } from "vitest";

import { newBrushMask } from "../lib/maskEdit";
import { applyPresetRecipe } from "./DevelopView";

/** A photo mid-edit: cropped, healed, masked, custom WB, neutral-chromaticity decode. */
function editedPhoto(): DevelopRecipeV2 {
  const r = createDefaultRecipe();
  return {
    ...r,
    rawDecode: { mode: "neutralChromaticity", x: 0.31, y: 0.33, derivationDigest: "abc" },
    crop: { ...r.crop, rect: { top: 0.1, left: 0.2, bottom: 0.8, right: 0.9 }, angle: 3 },
    basic: { ...r.basic, wbMode: "custom", temp: 12, tint: -4, exposure: 0.1 },
    heal: {
      spots: [
        { mode: "heal", x: 0.5, y: 0.5, sourceX: 0.6, sourceY: 0.6, radius: 0.02, feather: 0.5, opacity: 1 },
      ],
    },
    masks: { masks: [newBrushMask("m1", "Mask 1")] },
  };
}

/** A preset saved off some other photo: a look, plus that photo's own framing. */
function presetRecipe(): DevelopRecipeV2 {
  const r = createDefaultRecipe();
  return {
    ...r,
    crop: { ...r.crop, rect: { top: 0, left: 0, bottom: 0.5, right: 0.5 } },
    basic: { ...r.basic, wbMode: "asShot", temp: -30, tint: 20, exposure: 1.5, contrast: 25 },
    detail: { ...r.detail, sharpenAmount: 80 },
    heal: {
      spots: [
        { mode: "clone", x: 0.1, y: 0.1, sourceX: 0.2, sourceY: 0.2, radius: 0.05, feather: 0.5, opacity: 1 },
      ],
    },
  };
}

describe("applyPresetRecipe", () => {
  const out = applyPresetRecipe(editedPhoto(), presetRecipe());

  it("applies the preset's look", () => {
    expect(out.basic.exposure).toBeCloseTo(1.5, 6);
    expect(out.basic.contrast).toBeCloseTo(25, 6);
    expect(out.detail.sharpenAmount).toBeCloseTo(80, 6);
  });

  it("keeps the photo's crop", () => {
    expect(out.crop.rect).toEqual({ top: 0.1, left: 0.2, bottom: 0.8, right: 0.9 });
    expect(out.crop.angle).toBeCloseTo(3, 6);
  });

  it("keeps the photo's heal spots and masks", () => {
    expect(out.heal.spots).toHaveLength(1);
    expect(out.heal.spots[0].mode).toBe("heal");
    expect(out.masks.masks.map((m) => m.id)).toEqual(["m1"]);
  });

  it("keeps the photo's white balance and raw decode intent", () => {
    expect(out.basic.wbMode).toBe("custom");
    expect(out.basic.temp).toBeCloseTo(12, 6);
    expect(out.basic.tint).toBeCloseTo(-4, 6);
    expect(out.rawDecode).toEqual({ mode: "neutralChromaticity", x: 0.31, y: 0.33, derivationDigest: "abc" });
  });

  it("a neutral preset resets the look and nothing else", () => {
    const base = editedPhoto();
    const d = createDefaultRecipe();
    // Absolute settings, so a neutral preset does zero the look — but every
    // preserved key must come back byte-identical to the photo's own.
    expect(applyPresetRecipe(base, d)).toEqual({
      ...base,
      basic: { ...d.basic, wbMode: base.basic.wbMode, temp: base.basic.temp, tint: base.basic.tint },
    });
  });
});
