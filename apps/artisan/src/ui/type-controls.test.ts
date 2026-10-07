// ─────────────────────────────────────────────────────────────
// ui/type-controls.test — Type panel availability rules
// ─────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { isAlignDisabled } from "./type-controls";

describe("isAlignDisabled (Illustrator parity)", () => {
  it("disables Justify for point text (no box)", () => {
    expect(isAlignDisabled("justify", { boxWidth: undefined })).toBe(true);
  });

  it("enables Justify for area type (has a box)", () => {
    expect(isAlignDisabled("justify", { boxWidth: 200 })).toBe(false);
  });

  it("never disables left/center/right", () => {
    for (const a of ["left", "center", "right"] as const) {
      expect(isAlignDisabled(a, { boxWidth: undefined })).toBe(false);
      expect(isAlignDisabled(a, { boxWidth: 200 })).toBe(false);
    }
  });
});
