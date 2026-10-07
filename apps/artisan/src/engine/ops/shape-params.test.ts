// ─────────────────────────────────────────────────────────────
// ops/shape-params.test — live shape parameters (parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator's contextual shape properties — a live rectangle
// has a Corner Radius, a polygon has a Sides count, a star has a Points count.
// Editing a parameter regenerates the shape's geometry (live shapes).

import { describe, it, expect } from "vitest";
import { makeDocument, makeRect, makePolygon, makeStar, makeEllipse, makeLine, Ops, Query, Shapes, type Item } from "../index";

const anchorsOf = (it: Item) => Shapes.localPaths(it)[0].anchors.length;
const get = (doc: ReturnType<typeof makeDocument>, id: string) =>
  Query.getItem(doc, id)! as Item & { rx: number; ry: number; sides: number; points: number };
const star = (doc: ReturnType<typeof makeDocument>, id: string) =>
  Query.getItem(doc, id)! as Item & { radius1: number; radius2: number; points: number };

describe("ops.shape — live shape parameters", () => {
  it("setCornerRadius rounds a rectangle (rx=ry) and regenerates geometry", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 100, 60, 0, 0);
    Ops.Items.addItem(doc, r);
    expect(anchorsOf(get(doc, r.id))).toBe(4); // sharp corners
    Ops.Shape.setCornerRadius(doc, [r.id], 12);
    expect([get(doc, r.id).rx, get(doc, r.id).ry]).toEqual([12, 12]);
    expect(anchorsOf(get(doc, r.id))).toBe(8); // rounded corners
  });

  it("setCornerRadius clamps to half the shorter side", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 100, 60, 0, 0);
    Ops.Items.addItem(doc, r);
    Ops.Shape.setCornerRadius(doc, [r.id], 999);
    expect(get(doc, r.id).rx).toBe(30); // min(100,60)/2
  });

  it("setPolygonSides sets an integer side count and regenerates the polygon", () => {
    const doc = makeDocument();
    const p = makePolygon(100, 100, 50, 3);
    Ops.Items.addItem(doc, p);
    expect(anchorsOf(get(doc, p.id))).toBe(3);
    Ops.Shape.setPolygonSides(doc, [p.id], 6);
    expect(get(doc, p.id).sides).toBe(6);
    expect(anchorsOf(get(doc, p.id))).toBe(6);
  });

  it("setPolygonSides rounds to an integer and clamps to ≥3", () => {
    const doc = makeDocument();
    const p = makePolygon(100, 100, 50, 5);
    Ops.Items.addItem(doc, p);
    Ops.Shape.setPolygonSides(doc, [p.id], 1); // below min
    expect(get(doc, p.id).sides).toBe(3);
    Ops.Shape.setPolygonSides(doc, [p.id], 7.8); // non-integer
    expect(get(doc, p.id).sides).toBe(8);
  });

  it("setStarPoints sets the point count (a star has 2× anchors)", () => {
    const doc = makeDocument();
    const s = makeStar(100, 100, 50, 25, 5);
    Ops.Items.addItem(doc, s);
    expect(anchorsOf(get(doc, s.id))).toBe(10); // 5 points × 2
    Ops.Shape.setStarPoints(doc, [s.id], 8);
    expect(get(doc, s.id).points).toBe(8);
    expect(anchorsOf(get(doc, s.id))).toBe(16);
  });

  it("each setter ignores items of a non-matching type", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 100, 60, 0, 0);
    Ops.Items.addItem(doc, r);
    Ops.Shape.setPolygonSides(doc, [r.id], 6); // rect is not a polygon
    Ops.Shape.setStarPoints(doc, [r.id], 6);
    expect(get(doc, r.id).type).toBe("rect");
    expect(get(doc, r.id).rx).toBe(0); // untouched
  });

  it("setStarInnerRatio sets radius2 = radius1 × ratio, preserving outer radius + points", () => {
    const doc = makeDocument();
    const s = makeStar(100, 100, 80, 40, 5); // outer 80, inner 40 (50%), 5 points
    Ops.Items.addItem(doc, s);
    Ops.Shape.setStarInnerRatio(doc, [s.id], 0.25);
    const st = star(doc, s.id);
    expect(st.radius2).toBe(20); // 80 × 0.25
    expect(st.radius1).toBe(80); // outer unchanged
    expect(st.points).toBe(5); // points unchanged
    expect(anchorsOf(get(doc, s.id))).toBe(10); // still a 5-point star
  });

  it("setStarInnerRatio clamps the ratio to 0.05..1", () => {
    const doc = makeDocument();
    const s = makeStar(0, 0, 100, 50, 6);
    Ops.Items.addItem(doc, s);
    Ops.Shape.setStarInnerRatio(doc, [s.id], 5); // far over → clamp to 1
    expect(star(doc, s.id).radius2).toBe(100);
    Ops.Shape.setStarInnerRatio(doc, [s.id], 0); // under → clamp to 0.05
    expect(star(doc, s.id).radius2).toBe(5); // 100 × 0.05
  });

  it("setStarInnerRatio ignores non-star items", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 100, 60, 0, 0);
    Ops.Items.addItem(doc, r);
    Ops.Shape.setStarInnerRatio(doc, [r.id], 0.3);
    expect(get(doc, r.id).type).toBe("rect"); // untouched
  });

  it("setEllipsePie sets pie angles and regenerates a wedge (full → 4 anchors, pie → fewer)", () => {
    const doc = makeDocument();
    const e = makeEllipse(0, 0, 100, 60);
    Ops.Items.addItem(doc, e);
    expect(anchorsOf(get(doc, e.id))).toBe(4); // full ellipse
    Ops.Shape.setEllipsePie(doc, [e.id], 0, 90);
    const it = Query.getItem(doc, e.id) as Item & { pieStart: number; pieEnd: number };
    expect([it.pieStart, it.pieEnd]).toEqual([0, 90]);
    expect(anchorsOf(get(doc, e.id))).toBe(3); // wedge: apex + 2 arc anchors
  });

  it("setRectCornerStyle sets the style and regenerates a path (chamfer zeroes corner handles)", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 100, 60, 12, 12); // rounded
    Ops.Items.addItem(doc, r);
    Ops.Shape.setRectCornerStyle(doc, [r.id], "chamfer");
    expect((Query.getItem(doc, r.id) as { cornerStyle?: string }).cornerStyle).toBe("chamfer");
    expect(Shapes.localPaths(get(doc, r.id))[0].anchors[1].handleOut.x).toBe(0); // straight cut
  });

  it("setRectCornerStyle ignores non-rect items", () => {
    const doc = makeDocument();
    const p = makePolygon(100, 100, 50, 5);
    Ops.Items.addItem(doc, p);
    Ops.Shape.setRectCornerStyle(doc, [p.id], "chamfer");
    expect((Query.getItem(doc, p.id) as { cornerStyle?: string }).cornerStyle).toBeUndefined();
  });

  it("setLineLength keeps the start fixed, sets the length along the current direction, preserves angle", () => {
    const doc = makeDocument();
    const l = makeLine(0, 0, 100, 0); // length 100, angle 0 (east)
    Ops.Items.addItem(doc, l);
    Ops.Shape.setLineLength(doc, [l.id], 50);
    const it = Query.getItem(doc, l.id) as Item & { x1: number; y1: number; x2: number; y2: number };
    expect([it.x1, it.y1]).toEqual([0, 0]); // start fixed
    expect([it.x2, it.y2]).toEqual([50, 0]); // shortened along the same direction (angle preserved)
  });

  it("setLineAngle keeps the start fixed and rotates the end CCW from east, preserving length", () => {
    const doc = makeDocument();
    const l = makeLine(0, 0, 100, 0);
    Ops.Items.addItem(doc, l);
    Ops.Shape.setLineAngle(doc, [l.id], 90); // 90° → straight up (y-down screen)
    const it = Query.getItem(doc, l.id) as Item & { x1: number; y1: number; x2: number; y2: number };
    expect([it.x1, it.y1]).toEqual([0, 0]);
    expect(it.x2).toBeCloseTo(0, 6);
    expect(it.y2).toBeCloseTo(-100, 6); // up
    expect(Math.hypot(it.x2 - it.x1, it.y2 - it.y1)).toBeCloseTo(100, 6); // length preserved
    // reads back as 90°
    expect((Math.atan2(-(it.y2 - it.y1), it.x2 - it.x1) * 180) / Math.PI).toBeCloseTo(90, 6);
  });

  it("setLineLength/setLineAngle ignore non-line items", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 100, 60, 0, 0);
    Ops.Items.addItem(doc, r);
    expect(() => {
      Ops.Shape.setLineLength(doc, [r.id], 50);
      Ops.Shape.setLineAngle(doc, [r.id], 45);
    }).not.toThrow();
    expect(get(doc, r.id).type).toBe("rect"); // untouched (width still 100)
    expect((Query.getItem(doc, r.id) as { width: number }).width).toBe(100);
  });

  it("setEllipsePie ignores non-ellipse items", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 100, 60, 0, 0);
    Ops.Items.addItem(doc, r);
    Ops.Shape.setEllipsePie(doc, [r.id], 0, 90);
    expect((Query.getItem(doc, r.id) as { pieStart?: number }).pieStart).toBeUndefined();
  });
});
