import { describe, expect, it } from "vitest";
import { isPixelArt } from "./render";
import { createProject } from "./factory";

// Unity 2D Pixel Perfect Camera parity: `isPixelArt` is the single, coercion-safe
// source of truth the exporter + player read to decide nearest-filter rendering.

describe("isPixelArt", () => {
  it("is false for a fresh project (smooth rendering by default)", () => {
    expect(isPixelArt(createProject("P"))).toBe(false);
  });

  it("is true only when pixelArt is exactly true", () => {
    expect(isPixelArt(createProject("P", { pixelArt: true }))).toBe(true);
    expect(isPixelArt(createProject("P", { pixelArt: false }))).toBe(false);
  });

  it("defaults to false for legacy/in-memory projects missing the field", () => {
    // a project object that predates the flag (field absent / undefined)
    expect(isPixelArt({ pixelArt: undefined as unknown as boolean })).toBe(false);
    expect(isPixelArt({} as unknown as { pixelArt: boolean })).toBe(false);
  });
});
