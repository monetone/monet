import { describe, expect, it } from "vitest";
import {
  DEFAULT_MEASURE_SCALE,
  MAX_MEASURE_SCALE_PRESETS,
  deleteMeasureScalePreset,
  isDefaultMeasureScale,
  normalizeMeasureScale,
  normalizeMeasureScalePresets,
  saveMeasureScalePreset,
} from "./measureScale";

describe("measurement scale metadata", () => {
  it("preserves positive finite values and normalizes the unit label", () => {
    expect(normalizeMeasureScale({ px: 50, units: 1.5, unit: "  microns  " }))
      .toEqual({ px: 50, units: 1.5, unit: "microns" });
  });

  it("falls back safely for malformed persisted values", () => {
    expect(normalizeMeasureScale({ px: 0, units: Number.POSITIVE_INFINITY, unit: "   " }))
      .toEqual(DEFAULT_MEASURE_SCALE);
    expect(isDefaultMeasureScale(normalizeMeasureScale(null))).toBe(true);
    expect(normalizeMeasureScale({ px: 2, units: 3, unit: "u".repeat(100) }).unit).toHaveLength(80);
  });

  it("normalizes, bounds, saves, replaces, and deletes named presets", () => {
    let presets = saveMeasureScalePreset([], "  Microscope  ", { px: 50, units: 1, unit: " microns " });
    presets = saveMeasureScalePreset(presets, "Survey", { px: 100, units: 2, unit: "cm" });
    presets = saveMeasureScalePreset(presets, "microscope", { px: 25, units: 1, unit: "mm" });
    expect(presets).toEqual([
      { name: "Survey", px: 100, units: 2, unit: "cm" },
      { name: "microscope", px: 25, units: 1, unit: "mm" },
    ]);
    expect(deleteMeasureScalePreset(presets, "SURVEY")).toEqual([
      { name: "microscope", px: 25, units: 1, unit: "mm" },
    ]);
    const malformed = [null, { name: "Bad", px: 0, units: 1, unit: "px" }, ...Array.from(
      { length: MAX_MEASURE_SCALE_PRESETS + 5 },
      (_, i) => ({ name: `Scale ${i}`, px: i + 1, units: 1, unit: "px" }),
    )];
    expect(normalizeMeasureScalePresets(malformed)).toHaveLength(MAX_MEASURE_SCALE_PRESETS);
  });
});
