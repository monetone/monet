// `wbMode` is White Balance INTENT and is not carried by the engine ABI, so the
// only way a re-opened develop can still say "Tungsten" is to recognise the
// Temp/Tint offsets a preset writes. These tests pin that recovery — including
// across the real f32 params round-trip, which is where an exact-equality match
// would quietly fall back to "Custom".
import { describe, expect, it } from "vitest";
import { WB_PRESETS, whiteBalancePresetOffsets } from "@monet-ui/monet-photo";
import { defaultRecipe, paramsToRecipe, recipeToParams } from "./cameraRaw";
import { inferWbMode, visionRecipeToV2 } from "./cameraRawToV2";

/** Vision recipe → engine params → back, the path a Smart Object re-edit takes. */
const roundTripWbMode = (temp: number, tint: number) => {
  const r = defaultRecipe();
  r.basic = { ...r.basic, temp, tint };
  return visionRecipeToV2(paramsToRecipe(recipeToParams(r))).basic.wbMode;
};

describe("White Balance mode recovery from Temp/Tint", () => {
  it("calls an untouched white balance As Shot", () => {
    expect(inferWbMode(0, 0)).toBe("asShot");
  });

  it("recognises every lighting preset by its offsets", () => {
    for (const preset of WB_PRESETS) {
      const { temp, tint } = whiteBalancePresetOffsets(preset.mode);
      // Daylight IS the reference illuminant (zero offset), so it is by
      // construction indistinguishable from As Shot.
      const expected = temp === 0 && tint === 0 ? "asShot" : preset.mode;
      expect(inferWbMode(temp, tint)).toBe(expected);
    }
  });

  it("calls a hand-dialled offset Custom", () => {
    expect(inferWbMode(0.25, -0.125)).toBe("custom");
    // Near a preset but not on it — Tungsten is temp ≈ -0.845.
    expect(inferWbMode(-0.8, 0)).toBe("custom");
  });

  it("survives the f32 engine-params round trip", () => {
    for (const preset of WB_PRESETS) {
      const { temp, tint } = whiteBalancePresetOffsets(preset.mode);
      const expected = temp === 0 && tint === 0 ? "asShot" : preset.mode;
      expect(roundTripWbMode(temp, tint)).toBe(expected);
    }
  });

  it("keeps an unrecognised offset Custom after the round trip", () => {
    expect(roundTripWbMode(0.25, -0.125)).toBe("custom");
    expect(roundTripWbMode(0, 0)).toBe("asShot");
  });
});
