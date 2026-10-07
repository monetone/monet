// Guards the waveform display math in @monet-ui/monet-scopes from Artisan's side
// (its own divergent case coverage, kept alongside the package's own tests). The
// cols×rows density grids themselves are produced + tested in packages/engine.
import { describe, it, expect } from "vitest";
import { ireLines } from "@monet-ui/monet-scopes";

describe("waveform-draw (Artisan copy)", () => {
  it("returns the five standard IRE graticule levels", () => {
    expect(ireLines().map((l) => l.ire)).toEqual([0, 25, 50, 75, 100]);
  });

  it("places 100 IRE (white) at the top and 0 IRE (black) at the bottom", () => {
    const byIre = Object.fromEntries(ireLines().map((l) => [l.ire, l.yFrac]));
    expect(byIre[100]).toBeCloseTo(0, 6);
    expect(byIre[0]).toBeCloseTo(1, 6);
    expect(byIre[50]).toBeCloseTo(0.5, 6);
  });

  it("descends monotonically down the scope as IRE decreases", () => {
    const lines = ireLines();
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i].yFrac).toBeLessThan(lines[i - 1].yFrac);
    }
  });
});
