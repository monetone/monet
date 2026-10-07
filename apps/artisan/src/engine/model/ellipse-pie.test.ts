// ─────────────────────────────────────────────────────────────
// model/ellipse-pie.test — live ellipse Pie (wedge) geometry + export
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator's live Ellipse Pie Start / Pie End angles — a
// sweep below a full turn turns the ellipse into a wedge (an elliptical arc
// closed through the centre). Full sweep → a normal ellipse.

import { describe, it, expect } from "vitest";
import { makeDocument, makeEllipse, makeLayer, Ops, Shapes } from "../index";
import { exportSVG } from "../io/svg";

const { ellipsePath, isEllipsePie } = Shapes;

const KAPPA = 0.5522847498307936;

describe("Shapes.isEllipsePie", () => {
  it("is true only for a partial sweep", () => {
    expect(isEllipsePie(undefined, undefined)).toBe(false);
    expect(isEllipsePie(0, 0)).toBe(false);
    expect(isEllipsePie(0, 360)).toBe(false); // full turn
    expect(isEllipsePie(10, 370)).toBe(false); // full turn, offset
    expect(isEllipsePie(0, 90)).toBe(true);
    expect(isEllipsePie(45, 135)).toBe(true);
  });
});

describe("ellipsePath — pie wedge", () => {
  it("returns the full 4-bezier ellipse when not a pie", () => {
    expect(ellipsePath(100, 60).anchors).toHaveLength(4);
    expect(ellipsePath(100, 60, 0, 360).anchors).toHaveLength(4); // full turn
    expect(ellipsePath(100, 60).closed).toBe(true);
  });

  it("returns a closed wedge (centre apex + arc) for a partial sweep", () => {
    const p = ellipsePath(100, 60, 0, 90); // rx=50 ry=30 cx=50 cy=30, one 90° segment
    expect(p.closed).toBe(true);
    expect(p.anchors).toHaveLength(3); // apex + arc start + arc end
    expect(p.anchors[0].point).toEqual({ x: 50, y: 30 }); // centre apex
    expect(p.anchors[1].point.x).toBeCloseTo(100, 6); // angle 0 → right edge
    expect(p.anchors[1].point.y).toBeCloseTo(30, 6);
    expect(p.anchors[2].point.x).toBeCloseTo(50, 6); // angle 90 → bottom edge
    expect(p.anchors[2].point.y).toBeCloseTo(60, 6);
  });

  it("the 0→90 arc reuses the same KAPPA quarter as the full ellipse", () => {
    const p = ellipsePath(100, 60, 0, 90);
    expect(p.anchors[1].handleOut.y).toBeCloseTo(30 * KAPPA, 6); // ry·KAPPA out of the right edge
    expect(p.anchors[2].handleIn.x).toBeCloseTo(50 * KAPPA, 6); // rx·KAPPA into the bottom edge
    // straight lines join the centre to the arc ends (no handles there)
    expect(p.anchors[1].handleIn).toEqual({ x: 0, y: 0 });
    expect(p.anchors[2].handleOut).toEqual({ x: 0, y: 0 });
  });

  it("splits larger sweeps into ≤90° bezier segments", () => {
    expect(ellipsePath(100, 60, 0, 180).anchors).toHaveLength(4); // apex + 3 arc anchors (2 segs)
    expect(ellipsePath(100, 60, 0, 270).anchors).toHaveLength(5); // apex + 4 arc anchors (3 segs)
  });

  it("reduces a multi-turn span to a single turn (0→540 == a 180° wedge)", () => {
    const big = ellipsePath(100, 60, 0, 540); // 540° net → 180° wedge, consistent with isEllipsePie
    const half = ellipsePath(100, 60, 0, 180);
    expect(big.anchors).toHaveLength(half.anchors.length); // same wedge, not a full ellipse
    expect(big.anchors[big.anchors.length - 1].point.x).toBeCloseTo(0, 6); // 180° → left edge
    expect(big.anchors[big.anchors.length - 1].point.y).toBeCloseTo(30, 6);
  });
});

describe("exportSVG — ellipse pie", () => {
  const ellipseDoc = (pie: boolean) => {
    const doc = makeDocument();
    const e = makeEllipse(0, 0, 100, 60);
    if (pie) {
      e.pieStart = 0;
      e.pieEnd = 90;
    }
    doc.layers = [makeLayer("L", [e])];
    return doc;
  };

  it("exports a full ellipse as <ellipse> and a pie as <path>", () => {
    expect(exportSVG(ellipseDoc(false))).toContain("<ellipse");
    const pieSvg = exportSVG(ellipseDoc(true));
    expect(pieSvg).toContain("<path");
    expect(pieSvg).not.toContain("<ellipse");
  });
});

// Ops barrel sanity: setEllipsePie is reachable.
describe("Ops.Shape.setEllipsePie", () => {
  it("sets the pie angles on an ellipse", () => {
    const doc = makeDocument();
    const e = makeEllipse(0, 0, 100, 60);
    Ops.Items.addItem(doc, e);
    Ops.Shape.setEllipsePie(doc, [e.id], 30, 200);
    const it = doc.layers[0].items[0] as { pieStart?: number; pieEnd?: number };
    expect([it.pieStart, it.pieEnd]).toEqual([30, 200]);
  });
});
