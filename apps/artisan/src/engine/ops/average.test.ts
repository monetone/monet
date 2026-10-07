// ─────────────────────────────────────────────────────────────
// ops/average.test — Object ▸ Path ▸ Average (parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator "Average" (⌥⌘J) moves the SELECTED anchor points
// to their average position. Axis:
//   • Horizontal → all share the average Y (line up on a horizontal line)
//   • Vertical   → all share the average X (line up on a vertical line)
//   • Both       → all collapse onto the single average point
// Averaging happens in document (world) space; only the on-curve point moves.

import { describe, it, expect } from "vitest";
import { makeDocument, makePath, makeAnchor as anchor, Ops, Query } from "../index";

const geo = (doc: ReturnType<typeof makeDocument>, id: string) =>
  (Query.getItem(doc, id) as { geometry: { anchors: { point: { x: number; y: number } }[] } }).geometry;

describe("ops.path-edit.averageAnchors", () => {
  it('"both" collapses the selected anchors onto the average point', () => {
    const doc = makeDocument();
    const p = makePath({ closed: false, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 100, y: 40 })] });
    Ops.Items.addItem(doc, p);
    Ops.PathEdit.averageAnchors(doc, { [p.id]: [0, 1] }, "both");
    expect(geo(doc, p.id).anchors[0].point).toEqual({ x: 50, y: 20 });
    expect(geo(doc, p.id).anchors[1].point).toEqual({ x: 50, y: 20 });
  });

  it('"horizontal" shares the average Y, keeps each X', () => {
    const doc = makeDocument();
    const p = makePath({ closed: false, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 100, y: 40 })] });
    Ops.Items.addItem(doc, p);
    Ops.PathEdit.averageAnchors(doc, { [p.id]: [0, 1] }, "horizontal");
    expect(geo(doc, p.id).anchors[0].point).toEqual({ x: 0, y: 20 });
    expect(geo(doc, p.id).anchors[1].point).toEqual({ x: 100, y: 20 });
  });

  it('"vertical" shares the average X, keeps each Y', () => {
    const doc = makeDocument();
    const p = makePath({ closed: false, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 100, y: 40 })] });
    Ops.Items.addItem(doc, p);
    Ops.PathEdit.averageAnchors(doc, { [p.id]: [0, 1] }, "vertical");
    expect(geo(doc, p.id).anchors[0].point).toEqual({ x: 50, y: 0 });
    expect(geo(doc, p.id).anchors[1].point).toEqual({ x: 50, y: 40 });
  });

  it("averages across two differently-positioned paths in WORLD space", () => {
    const doc = makeDocument();
    const a = makePath({ closed: false, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 5, y: 5 })] });
    a.transform = { a: 1, b: 0, c: 0, d: 1, e: 10, f: 0 }; // shifted +10 in x
    const b = makePath({ closed: false, anchors: [anchor({ x: 30, y: 40 }), anchor({ x: 35, y: 45 })] });
    Ops.Items.addItem(doc, a);
    Ops.Items.addItem(doc, b);
    // select a[0] (world 10,0) + b[0] (world 30,40) → world average (20,20)
    Ops.PathEdit.averageAnchors(doc, { [a.id]: [0], [b.id]: [0] }, "both");
    const pa = geo(doc, a.id).anchors[0].point;
    const pb = geo(doc, b.id).anchors[0].point;
    expect(pa.x).toBeCloseTo(10); // world 20 → local 20-10
    expect(pa.y).toBeCloseTo(20);
    expect(pb.x).toBeCloseTo(20);
    expect(pb.y).toBeCloseTo(20);
    // the unselected anchors are untouched
    expect(geo(doc, a.id).anchors[1].point).toEqual({ x: 5, y: 5 });
    expect(geo(doc, b.id).anchors[1].point).toEqual({ x: 35, y: 45 });
  });

  it("moves only the SELECTED anchors (others stay put)", () => {
    const doc = makeDocument();
    const p = makePath({ closed: false, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 50, y: 90 }), anchor({ x: 100, y: 0 })] });
    Ops.Items.addItem(doc, p);
    Ops.PathEdit.averageAnchors(doc, { [p.id]: [0, 2] }, "both"); // average ends only
    expect(geo(doc, p.id).anchors[0].point).toEqual({ x: 50, y: 0 });
    expect(geo(doc, p.id).anchors[2].point).toEqual({ x: 50, y: 0 });
    expect(geo(doc, p.id).anchors[1].point).toEqual({ x: 50, y: 90 }); // middle untouched
  });

  it("needs ≥2 anchors — a single selected anchor is a no-op", () => {
    const doc = makeDocument();
    const p = makePath({ closed: false, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 100, y: 40 })] });
    Ops.Items.addItem(doc, p);
    Ops.PathEdit.averageAnchors(doc, { [p.id]: [0] }, "both");
    expect(geo(doc, p.id).anchors[0].point).toEqual({ x: 0, y: 0 });
  });
});
