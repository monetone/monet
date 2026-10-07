// Unit tests for the Edit ▸ Fill contents helpers. Engine-free (node); the dialog +
// store wiring are covered by e2e/fill-contents.spec.ts.
import { describe, it, expect } from "vitest";
import { resolveFillRgb, hexToRgb, FILL_CONTENTS, type RGB } from "./fillContents";

const F: RGB = [10, 20, 30];
const B: RGB = [200, 210, 220];
const C: RGB = [1, 2, 3];

describe("resolveFillRgb", () => {
  it("maps colour-based contents to their RGB", () => {
    expect(resolveFillRgb("fg", F, B, C)).toEqual(F);
    expect(resolveFillRgb("bg", F, B, C)).toEqual(B);
    expect(resolveFillRgb("color", F, B, C)).toEqual(C);
    expect(resolveFillRgb("black", F, B, C)).toEqual([0, 0, 0]);
    expect(resolveFillRgb("white", F, B, C)).toEqual([255, 255, 255]);
    expect(resolveFillRgb("gray", F, B, C)).toEqual([128, 128, 128]);
  });

  it("returns null for non-flat-colour contents (pattern, content-aware, history)", () => {
    expect(resolveFillRgb("pattern", F, B, C)).toBeNull();
    expect(resolveFillRgb("contentAware", F, B, C)).toBeNull();
    expect(resolveFillRgb("history", F, B, C)).toBeNull();
  });
});

describe("hexToRgb", () => {
  it("parses #rrggbb", () => {
    expect(hexToRgb("#ff8000")).toEqual([255, 128, 0]);
    expect(hexToRgb("#000000")).toEqual([0, 0, 0]);
    expect(hexToRgb("ffffff")).toEqual([255, 255, 255]); // tolerates a missing '#'
  });

  it("falls back to 0 for malformed components", () => {
    expect(hexToRgb("#zzzzzz")).toEqual([0, 0, 0]);
    expect(hexToRgb("#")).toEqual([0, 0, 0]);
  });
});

describe("FILL_CONTENTS", () => {
  it("includes the Color…, Content-Aware, and History additions", () => {
    const values = FILL_CONTENTS.map((c) => c.value);
    expect(values).toContain("color");
    expect(values).toContain("contentAware");
    expect(values).toContain("history");
  });
});
