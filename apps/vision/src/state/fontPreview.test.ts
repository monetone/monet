import { describe, expect, it } from "vitest";
import {
  DEFAULT_FONT_PREVIEW_SIZE,
  FONT_PREVIEW_CHOICES,
  fontPreviewOptionStyle,
  normalizeFontPreviewSize,
} from "./fontPreview";

describe("font preview size", () => {
  it("defines Photoshop's six ordered choices and normalizes persisted input", () => {
    expect(FONT_PREVIEW_CHOICES.map((choice) => choice.label)).toEqual([
      "None", "Small", "Medium", "Large", "Extra Large", "Huge",
    ]);
    expect(normalizeFontPreviewSize("huge")).toBe("huge");
    expect(normalizeFontPreviewSize("bogus")).toBe(DEFAULT_FONT_PREVIEW_SIZE);
    expect(normalizeFontPreviewSize(null)).toBe(DEFAULT_FONT_PREVIEW_SIZE);
  });

  it("turns previews off or returns progressively larger font-list styles", () => {
    expect(fontPreviewOptionStyle("Georgia, serif", "none")).toBeUndefined();
    const small = fontPreviewOptionStyle("Georgia, serif", "small")!;
    const medium = fontPreviewOptionStyle("Georgia, serif", "medium")!;
    const huge = fontPreviewOptionStyle("Georgia, serif", "huge")!;
    expect(small.fontFamily).toBe("Georgia, serif");
    expect(small.fontSize).toBeLessThan(medium.fontSize);
    expect(medium.fontSize).toBeLessThan(huge.fontSize);
    expect(small.minHeight).toBeLessThan(huge.minHeight);
  });
});
