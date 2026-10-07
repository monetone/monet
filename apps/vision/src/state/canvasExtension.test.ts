// Unit tests for the Canvas Size extension-color resolver. Engine-free (node); the
// dialog + engine wiring are covered by e2e/canvas-extension.spec.ts.
import { describe, it, expect } from "vitest";
import { resolveExtensionColor, EXTENSION_COLORS } from "./canvasExtension";
import { type RGB } from "./fillContents";

const FG: RGB = [10, 20, 30];
const BG: RGB = [200, 210, 220];

describe("resolveExtensionColor", () => {
  it("none is fully transparent (alpha 0)", () => {
    expect(resolveExtensionColor("none", FG, BG, "#ffffff")).toEqual([0, 0, 0, 0]);
  });

  it("foreground / background pull from the passed colours, opaque", () => {
    expect(resolveExtensionColor("foreground", FG, BG, "#ffffff")).toEqual([10, 20, 30, 255]);
    expect(resolveExtensionColor("background", FG, BG, "#ffffff")).toEqual([200, 210, 220, 255]);
  });

  it("white / black / gray are the fixed opaque values", () => {
    expect(resolveExtensionColor("white", FG, BG, "#ffffff")).toEqual([255, 255, 255, 255]);
    expect(resolveExtensionColor("black", FG, BG, "#ffffff")).toEqual([0, 0, 0, 255]);
    expect(resolveExtensionColor("gray", FG, BG, "#ffffff")).toEqual([128, 128, 128, 255]);
  });

  it("other parses the custom hex, opaque", () => {
    expect(resolveExtensionColor("other", FG, BG, "#ff8000")).toEqual([255, 128, 0, 255]);
  });
});

describe("EXTENSION_COLORS", () => {
  it("offers none + the colour choices", () => {
    const values = EXTENSION_COLORS.map((c) => c.value);
    expect(values).toContain("none");
    expect(values).toContain("foreground");
    expect(values).toContain("other");
  });
});
