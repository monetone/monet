// ─────────────────────────────────────────────────────────────
// ui/fonts.test — font menu options + missing-font detection
// ─────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { FONT_FAMILIES, familyLabel, fontOptions, isFamilyAvailable } from "./fonts";

describe("ui/fonts", () => {
  it("fontOptions injects the current family as the first option when it isn't curated", () => {
    const opts = fontOptions("Frutiger, sans-serif");
    expect(opts[0]).toEqual({ label: "Frutiger", value: "Frutiger, sans-serif" });
    expect(opts).toHaveLength(FONT_FAMILIES.length + 1);
  });

  it("fontOptions returns the curated list unchanged for a known family", () => {
    expect(fontOptions(FONT_FAMILIES[0].value)).toBe(FONT_FAMILIES);
  });

  it("familyLabel de-quotes the first family in a stack", () => {
    expect(familyLabel('"Times New Roman", Times, serif')).toBe("Times New Roman");
    expect(familyLabel("Georgia, serif")).toBe("Georgia");
  });

  it("isFamilyAvailable returns true when it can't be determined (no DOM / test env)", () => {
    // node env has no `document`, so detection degrades to "available" (never cries wolf)
    expect(isFamilyAvailable("Frutiger, sans-serif")).toBe(true);
    expect(isFamilyAvailable("")).toBe(true);
  });
});
