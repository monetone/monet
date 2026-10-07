// ─────────────────────────────────────────────────────────────
// color.test — complement() + invert() (Illustrator Color panel)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Color panel ▸ Complement reflects each channel
// about (max + min) of the colour's channels; ▸ Invert is the photographic
// negative (255 − each channel). Both preserve alpha.

import { describe, it, expect } from "vitest";
import { complement, invert, rgba } from "./color";

describe("color.complement", () => {
  it("maps a primary to its complement (red → cyan, keeping the range)", () => {
    expect(complement(rgba(220, 0, 0))).toEqual(rgba(0, 220, 220)); // max 220, min 0 → 220−ch
  });

  it("complements a mid colour about (max+min)", () => {
    // (50,100,200): max 200, min 50, sum 250 → (200,150,50)
    expect(complement(rgba(50, 100, 200))).toEqual(rgba(200, 150, 50));
  });

  it("is an involution — applying it twice returns the original", () => {
    const c = rgba(30, 90, 210, 0.5);
    expect(complement(complement(c))).toEqual(c);
  });

  it("leaves greys unchanged (a grey is its own complement)", () => {
    expect(complement(rgba(128, 128, 128))).toEqual(rgba(128, 128, 128));
    expect(complement(rgba(0, 0, 0))).toEqual(rgba(0, 0, 0));
    expect(complement(rgba(255, 255, 255))).toEqual(rgba(255, 255, 255));
  });

  it("preserves alpha", () => {
    expect(complement(rgba(220, 0, 0, 0.25)).a).toBe(0.25);
  });
});

describe("color.invert", () => {
  it("is the photographic negative (255 − each channel)", () => {
    expect(invert(rgba(220, 0, 0))).toEqual(rgba(35, 255, 255));
    expect(invert(rgba(0, 0, 0))).toEqual(rgba(255, 255, 255));
  });

  it("is an involution and preserves alpha", () => {
    const c = rgba(30, 90, 210, 0.4);
    expect(invert(invert(c))).toEqual(c);
    expect(invert(c).a).toBe(0.4);
  });
});
