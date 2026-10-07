// MaskOverlay.handles.test — GAL-MASK-11: the linear gradient gains LR's three
// control lines and a translate grip; the radial gains a rotation grip, with the
// radius handles riding the same rotated axes maskRender's coverage uses (so the
// handle you drag sits on the edge you see).

import { describe, expect, it } from "vitest";

import type { LinearGradientComponent, RadialGradientComponent } from "@monet-ui/monet-photo";

import { linearGuides, linearTranslate, radialHandles, radialPatch } from "./MaskOverlay";

const linear = (over: Partial<LinearGradientComponent> = {}): LinearGradientComponent => ({
  kind: "linearGradient",
  id: "l1",
  combine: "add",
  invert: false,
  x1: 0.2,
  y1: 0.5,
  x2: 0.8,
  y2: 0.5,
  ...over,
});

const radial = (over: Partial<RadialGradientComponent> = {}): RadialGradientComponent => ({
  kind: "radialGradient",
  id: "r1",
  combine: "add",
  invert: false,
  cx: 0.5,
  cy: 0.5,
  rx: 0.3,
  ry: 0.1,
  angle: 0,
  feather: 0.5,
  ...over,
});

describe("linear gradient handles (GAL-MASK-11)", () => {
  it("draws three control lines perpendicular to the axis, at start/mid/end", () => {
    const guides = linearGuides(linear());
    expect(guides).toHaveLength(3);
    // Horizontal axis → vertical guides, centred on x = 0.2 / 0.5 / 0.8.
    expect(guides.map((g) => g.x1)).toEqual([0.2, 0.5, 0.8]);
    for (const g of guides) {
      expect(g.x2).toBeCloseTo(g.x1); // vertical
      expect(g.y2 - g.y1).not.toBe(0); // and actually a line
    }
  });

  it("keeps the guides perpendicular for a diagonal axis", () => {
    const c = linear({ x1: 0, y1: 0, x2: 1, y2: 1 });
    for (const g of linearGuides(c)) {
      const dot = (g.x2 - g.x1) * (c.x2 - c.x1) + (g.y2 - g.y1) * (c.y2 - c.y1);
      expect(dot).toBeCloseTo(0);
    }
  });

  it("translates the whole axis so the mid grip lands under the pointer", () => {
    const moved = linearTranslate(linear(), 0.6, 0.9);
    expect((moved.x1 + moved.x2) / 2).toBeCloseTo(0.6);
    expect((moved.y1 + moved.y2) / 2).toBeCloseTo(0.9);
    expect(moved.x2 - moved.x1).toBeCloseTo(0.6); // length and direction preserved
    expect(moved.y2 - moved.y1).toBeCloseTo(0);
  });
});

describe("radial gradient handles (GAL-MASK-11)", () => {
  it("puts the radius handles on the rotated axes", () => {
    const c = radial({ angle: Math.PI / 2 }); // quarter turn: rx now points +y
    const h = radialHandles(c);
    expect(h.rx.x).toBeCloseTo(0.5);
    expect(h.rx.y).toBeCloseTo(0.8);
    expect(h.ry.x).toBeCloseTo(0.4);
    expect(h.ry.y).toBeCloseTo(0.5);
  });

  it("keeps the rotation grip outside the ellipse, on the rx axis", () => {
    const h = radialHandles(radial());
    expect(h.rot.y).toBeCloseTo(0.5);
    expect(h.rot.x).toBeGreaterThan(h.rx.x);
  });

  it("dragging the rotation grip sets the angle to the pointer's bearing", () => {
    expect(radialPatch(radial(), "rot", 0.5, 0.9).angle).toBeCloseTo(Math.PI / 2);
    expect(radialPatch(radial(), "rot", 0.1, 0.5).angle).toBeCloseTo(Math.PI);
  });

  it("projects radius drags onto the rotated axes, so a rotated ellipse resizes on-axis", () => {
    const c = radial({ angle: Math.PI / 2 });
    // Pointer straight below the centre is along the rotated rx axis.
    expect(radialPatch(c, "rx", 0.5, 0.75).rx).toBeCloseTo(0.25);
    // The same pointer contributes nothing to ry (perpendicular) → floors out.
    expect(radialPatch(c, "ry", 0.5, 0.75).ry).toBeCloseTo(0.02);
    // Off the +x side is the rotated ry axis.
    expect(radialPatch(c, "ry", 0.35, 0.5).ry).toBeCloseTo(0.15);
  });

  it("round-trips: a handle dragged to its own drawn position leaves the geometry alone", () => {
    const c = radial({ angle: 0.7 });
    const h = radialHandles(c);
    expect(radialPatch(c, "rx", h.rx.x, h.rx.y).rx).toBeCloseTo(c.rx);
    expect(radialPatch(c, "ry", h.ry.x, h.ry.y).ry).toBeCloseTo(c.ry);
    expect(radialPatch(c, "rot", h.rot.x, h.rot.y).angle).toBeCloseTo(c.angle);
  });
});
