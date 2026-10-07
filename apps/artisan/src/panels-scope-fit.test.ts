// Guards the offscreen analysis surface the waveform/vectorscope panels render
// into. The scope ops read the WHOLE surface, so any letterbox left around a
// non-square artboard is analysed as if it were artwork (and squeezes the
// waveform's x axis, which is the surface's x axis).
import { describe, it, expect } from "vitest";
import { scopeFit, type ArtboardRect } from "./ui/panels/scope-fit";

const BUDGET = 256;

/** Where the artboard's corners land on the analysis surface. */
function corners(ab: ArtboardRect, budget = BUDGET) {
  const f = scopeFit(ab, budget);
  return {
    fit: f,
    left: f.panX + ab.x * f.zoom,
    right: f.panX + (ab.x + ab.width) * f.zoom,
    top: f.panY + ab.y * f.zoom,
    bottom: f.panY + (ab.y + ab.height) * f.zoom,
  };
}

describe("scope-fit", () => {
  it("uses a square surface for a square artboard", () => {
    const f = scopeFit({ x: 0, y: 0, width: 500, height: 500 }, BUDGET);
    expect(f.width).toBe(BUDGET);
    expect(f.height).toBe(BUDGET);
  });

  it("matches the surface aspect to the artboard, longest side at the budget", () => {
    expect(scopeFit({ x: 0, y: 0, width: 1000, height: 250 }, BUDGET)).toMatchObject({ width: 256, height: 64 });
    expect(scopeFit({ x: 0, y: 0, width: 250, height: 1000 }, BUDGET)).toMatchObject({ width: 64, height: 256 });
  });

  it("leaves no letterbox: the artboard fills the surface on both axes", () => {
    for (const ab of [
      { x: 0, y: 0, width: 500, height: 500 },
      { x: -120, y: 40, width: 1200, height: 300 }, // landscape, off-origin
      { x: 800, y: -50, width: 210, height: 990 }, // portrait, off-origin
    ]) {
      const c = corners(ab);
      // Fully inside the surface, centred, and covering ≥99% of both axes —
      // the remainder is the ≤0.5px rounding of the short side. A square
      // surface would leave the short axis at (short/long) coverage instead.
      expect(c.left).toBeGreaterThanOrEqual(-1e-6);
      expect(c.top).toBeGreaterThanOrEqual(-1e-6);
      expect(c.right).toBeLessThanOrEqual(c.fit.width + 1e-6);
      expect(c.bottom).toBeLessThanOrEqual(c.fit.height + 1e-6);
      expect(c.left).toBeCloseTo(c.fit.width - c.right, 5);
      expect(c.top).toBeCloseTo(c.fit.height - c.bottom, 5);
      expect((c.right - c.left) / c.fit.width).toBeGreaterThan(0.99);
      expect((c.bottom - c.top) / c.fit.height).toBeGreaterThan(0.99);
    }
  });

  it("never renders more pixels than the square surface it replaces", () => {
    const f = scopeFit({ x: 0, y: 0, width: 1600, height: 400 }, BUDGET);
    expect(f.width * f.height).toBeLessThanOrEqual(BUDGET * BUDGET);
  });

  it("keeps degenerate aspects renderable (≥1px, finite zoom)", () => {
    for (const ab of [
      { x: 0, y: 0, width: 4000, height: 1 },
      { x: 0, y: 0, width: 1, height: 4000 },
      { x: 0, y: 0, width: Number.NaN, height: 10 },
    ]) {
      const f = scopeFit(ab, BUDGET);
      expect(f.width).toBeGreaterThanOrEqual(1);
      expect(f.height).toBeGreaterThanOrEqual(1);
      expect(f.width).toBeLessThanOrEqual(BUDGET);
      expect(f.height).toBeLessThanOrEqual(BUDGET);
    }
  });
});
