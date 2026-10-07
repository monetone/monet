// Guards the vectorscope display math in @monet-ui/monet-scopes from Artisan's
// side (its own divergent case coverage, kept alongside the package's own tests).
// The n×n density grid itself is produced + tested in packages/engine.
import { describe, it, expect } from "vitest";
import { rgbToScope, vectorscopeTargets, skinToneLine, cellHue } from "@monet-ui/monet-scopes";

describe("vectorscope-draw (Artisan copy)", () => {
  it("maps neutral gray to the centre and bright red to the upper half", () => {
    expect(rgbToScope(0.5, 0.5, 0.5)).toMatchObject({ fx: expect.closeTo(0.5, 6), fy: expect.closeTo(0.5, 6) });
    expect(rgbToScope(1, 0, 0).fy).toBeLessThan(0.5);
  });

  it("emits the six broadcast hue targets inside the unit square", () => {
    const t = vectorscopeTargets();
    expect(t.map((x) => x.label)).toEqual(["R", "Yl", "G", "Cy", "B", "Mg"]);
    for (const { fx, fy } of t) {
      expect(fx).toBeGreaterThanOrEqual(0);
      expect(fx).toBeLessThanOrEqual(1);
      expect(fy).toBeGreaterThanOrEqual(0);
      expect(fy).toBeLessThanOrEqual(1);
    }
  });

  it("runs the skin-tone line from centre into the orange quadrant", () => {
    const { cx, cy, ex, ey } = skinToneLine();
    expect([cx, cy]).toEqual([0.5, 0.5]);
    expect(ex).toBeLessThan(0.5);
    expect(ey).toBeLessThan(0.5);
  });

  it("reconstructs a red-ish hue for a red cell and blue-ish for a blue cell", () => {
    const red = rgbToScope(1, 0, 0);
    const hr = cellHue(red.fx, red.fy);
    expect(hr < 30 || hr > 330).toBe(true);
    const blue = rgbToScope(0, 0, 1);
    const hb = cellHue(blue.fx, blue.fy);
    expect(hb).toBeGreaterThan(180);
    expect(hb).toBeLessThan(300);
  });
});
