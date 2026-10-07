// ─────────────────────────────────────────────────────────────
// gradient.test — Gradient tool aiming (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Gradient tool — drag across an object to set the
// gradient's direction/length. A LINEAR gradient follows the drag as its axis; a
// RADIAL gradient's CENTRE is the drag start and its RADIUS is the drag length.

import { describe, it, expect } from "vitest";
import { linearGradient, radialGradient, aimGradient, type Gradient, type Paint } from "./index";

const gradOf = (p: Paint): Gradient => {
  if (p.type !== "gradient") throw new Error("not a gradient");
  return p.gradient;
};

describe("aimGradient", () => {
  it("sets the linear axis from the drag (radial fields untouched)", () => {
    const g = gradOf(linearGradient());
    const out = aimGradient(g, { x: 0.2, y: 0.3 }, { x: 0.8, y: 0.7 });
    expect([out.x1, out.y1, out.x2, out.y2]).toEqual([0.2, 0.3, 0.8, 0.7]);
    expect([out.cx, out.cy, out.r]).toEqual([g.cx, g.cy, g.r]); // unchanged for a linear gradient
  });

  it("aims a RADIAL gradient: centre = drag start, radius = drag length", () => {
    const g = gradOf(radialGradient());
    const out = aimGradient(g, { x: 0.5, y: 0.5 }, { x: 0.5, y: 1.0 });
    expect([out.cx, out.cy]).toEqual([0.5, 0.5]); // centre at the drag start
    expect(out.r).toBeCloseTo(0.5, 6); // |(0.5,1.0)-(0.5,0.5)| = 0.5
    expect([out.fx, out.fy]).toEqual([0.5, 0.5]); // focal at the centre
    expect([out.x1, out.y1, out.x2, out.y2]).toEqual([0.5, 0.5, 0.5, 1.0]); // axis kept in sync
  });

  it("does not mutate the input gradient", () => {
    const g = gradOf(radialGradient());
    const before = JSON.stringify(g);
    aimGradient(g, { x: 0.1, y: 0.1 }, { x: 0.9, y: 0.9 });
    expect(JSON.stringify(g)).toBe(before);
  });
});
