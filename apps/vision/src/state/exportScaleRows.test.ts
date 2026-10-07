import { describe, expect, it } from "vitest";
import {
  duplicateExportScaleFilename,
  duplicateExportScaleTargetFilename,
  exportScaleDimensions,
  exportScaleFits,
  exportScaleFilename,
  exportScaleTargetFilename,
  normalizeExportScaleRows,
} from "./exportScaleRows";

describe("Export As scale rows", () => {
  it("normalizes untrusted scales and filename suffixes", () => {
    expect(normalizeExportScaleRows([])).toEqual([{ scale: 1, suffix: "" }]);
    expect(normalizeExportScaleRows([
      { scale: Number.NaN, suffix: "bad/path" },
      { scale: 99, suffix: "@large" },
      { scale: 0, suffix: "@small" },
    ])).toEqual([
      { scale: 1, suffix: "bad_path" },
      { scale: 8, suffix: "@large" },
      { scale: 0.05, suffix: "@small" },
    ]);
  });

  it("builds literal suffix names and catches case-insensitive collisions", () => {
    const rows = normalizeExportScaleRows([
      { scale: 1, suffix: "" },
      { scale: 1.25, suffix: "@1.25x" },
    ]);
    expect(exportScaleFilename("poster.psd", "png", rows[1])).toBe("poster@1.25x.png");
    expect(exportScaleFilename("poster.psd", "gif", rows[1])).toBe("poster@1.25x.gif");
    expect(exportScaleTargetFilename("Hero.v2", "png", rows[1])).toBe("Hero.v2@1.25x.png");
    expect(duplicateExportScaleFilename("poster.psd", "png", rows)).toBeNull();
    expect(duplicateExportScaleFilename("poster.psd", "jpg", [
      { scale: 1, suffix: "@Retina" },
      { scale: 2, suffix: "@retina" },
    ])).toBe("poster@retina.jpg");
    expect(duplicateExportScaleTargetFilename(["Badge", "badge"], "png", [
      { scale: 1, suffix: "" },
    ])).toBe("badge.png");
    expect(duplicateExportScaleTargetFilename(["Badge", "Mark"], "png", rows)).toBeNull();
  });

  it("uses the engine's rounded size and allocation limits", () => {
    expect(exportScaleDimensions(8, 4, 1.25)).toEqual([10, 5]);
    expect(exportScaleDimensions(15, 1, 2.1)).toEqual([31, 2]);
    expect(exportScaleDimensions(25, 1, 0.06)).toEqual([2, 1]);
    expect(exportScaleFits(8, 4, 8)).toBe(true);
    expect(exportScaleFits(5_000, 1, 8)).toBe(false);
    expect(exportScaleFits(8_192, 8_192, 2)).toBe(false);
  });
});
