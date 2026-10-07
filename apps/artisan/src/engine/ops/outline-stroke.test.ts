// ─────────────────────────────────────────────────────────────
// ops/outline-stroke.test — Object ▸ Path ▸ Outline Stroke (parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Outline Stroke — converts an object's stroke into
// a FILLED compound path (filled with the stroke colour, no stroke). The object's
// fill is kept as a separate path and the two are grouped.

import { describe, it, expect } from "vitest";
import { makeDocument, makeGroup, makePath, makeAnchor as anchor, Ops, Query, solid, noPaint, defaultStroke, rgba } from "../index";
import type { Item } from "../index";

const RED = rgba(220, 0, 0);
const BLUE = rgba(0, 0, 220);
const strokeOf = (color: ReturnType<typeof rgba>, width: number) => ({ ...defaultStroke(solid(color)), width });

const ringArea = (anchors: { point: { x: number; y: number } }[]): number => {
  let a = 0;
  for (let i = 0, n = anchors.length; i < n; i++) {
    const p = anchors[i].point;
    const q = anchors[(i + 1) % n].point;
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a / 2);
};
const itemArea = (it: Item): number =>
  it.type === "path" ? ringArea(it.geometry.anchors) : it.type === "compound" ? it.subpaths.reduce((s, sp) => s + ringArea(sp.anchors), 0) : 0;

describe("ops.path-edit.outlineStroke", () => {
  it("outlines grouped leaves once when both group and child are selected", () => {
    const doc = makeDocument();
    const line = makePath(
      { closed: false, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 100, y: 0 })] },
      { fill: noPaint(), stroke: strokeOf(BLUE, 10) },
    );
    const group = makeGroup([line]);
    Ops.Items.addItem(doc, group);

    const ids = Ops.PathEdit.outlineStroke(doc, [group.id, line.id]);

    expect(ids).toHaveLength(1);
    expect(group.children).toHaveLength(1);
    expect(group.children[0].id).toBe(ids[0]);
  });

  it("outlines a stroked OPEN path into a filled band (no fill on the path)", () => {
    const doc = makeDocument();
    const line = makePath({ closed: false, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 100, y: 0 })] }, { fill: noPaint(), stroke: strokeOf({ r: 0, g: 0, b: 0, a: 1 }, 10) });
    Ops.Items.addItem(doc, line);
    const ids = Ops.PathEdit.outlineStroke(doc, [line.id]);
    expect(ids.length).toBe(1);
    const it = Query.getItem(doc, ids[0])!;
    expect(it.type).toBe("compound");
    expect(it.fill).toEqual(solid({ r: 0, g: 0, b: 0, a: 1 })); // filled with the stroke colour
    expect(it.stroke.paint.type).toBe("none"); // and no stroke itself
    expect(itemArea(it)).toBeCloseTo(1000, 0); // 100 long × 10 wide band
  });

  it("keeps the fill as a separate path and groups it with the outline", () => {
    const doc = makeDocument();
    const sq = makePath({ closed: true, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 100, y: 0 }), anchor({ x: 100, y: 100 }), anchor({ x: 0, y: 100 })] }, { fill: solid(RED), stroke: strokeOf(BLUE, 10) });
    Ops.Items.addItem(doc, sq);
    const ids = Ops.PathEdit.outlineStroke(doc, [sq.id]);
    expect(ids.length).toBe(1);
    const g = Query.getItem(doc, ids[0])!;
    expect(g.type).toBe("group");
    if (g.type !== "group") return;
    expect(g.children.length).toBe(2);
    const [fillShape, outlineShape] = g.children;
    expect(fillShape.fill).toEqual(solid(RED)); // original fill kept
    expect(fillShape.stroke.paint.type).toBe("none");
    expect(outlineShape.fill).toEqual(solid(BLUE)); // outline filled with the stroke colour
    expect(outlineShape.stroke.paint.type).toBe("none");
    expect(outlineShape.type === "compound" && outlineShape.evenOdd).toBe(true); // band = even-odd
  });

  it("carries the source opacity + blend mode onto the group (children neutral)", () => {
    const doc = makeDocument();
    const sq = makePath({ closed: true, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 100, y: 0 }), anchor({ x: 100, y: 100 }), anchor({ x: 0, y: 100 })] }, { fill: solid(RED), stroke: strokeOf(BLUE, 10) });
    sq.opacity = 0.5;
    sq.blendMode = "multiply";
    Ops.Items.addItem(doc, sq);
    const ids = Ops.PathEdit.outlineStroke(doc, [sq.id]);
    const g = Query.getItem(doc, ids[0])!;
    if (g.type !== "group") throw new Error("expected group");
    expect(g.opacity).toBe(0.5); // group composites at the source opacity
    expect(g.blendMode).toBe("multiply");
    expect(g.children.every((c) => c.opacity === 1)).toBe(true); // not applied twice
  });

  it("leaves an object with no stroke untouched", () => {
    const doc = makeDocument();
    const p = makePath({ closed: true, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 10, y: 0 }), anchor({ x: 10, y: 10 })] }, { fill: solid(RED), stroke: defaultStroke(noPaint()) });
    Ops.Items.addItem(doc, p);
    expect(Ops.PathEdit.outlineStroke(doc, [p.id])).toEqual([]);
    expect(Query.getItem(doc, p.id)).not.toBeNull();
  });

  it("outlines a stroke that exists only in the appearance stack", () => {
    const doc = makeDocument();
    const p = makePath({ closed: false, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 100, y: 0 })] }, { fill: noPaint(), stroke: defaultStroke(noPaint()) });
    p.appearance = { entries: [
      { id: "none", kind: "stroke", stroke: defaultStroke(noPaint()) },
      { id: "visible", kind: "stroke", stroke: strokeOf(BLUE, 20) },
    ] };
    Ops.Items.addItem(doc, p);

    const out = Ops.PathEdit.outlineStroke(doc, [p.id]);

    expect(out).toHaveLength(1);
    expect(Query.getItem(doc, out[0])!.fill).toEqual(solid(BLUE));
  });
});

describe("ops.pathEdit.outlineStroke — Align Stroke", () => {
  // The renderer emulates inside/outside alignment by clipping a 2x-width stroke
  // to the shape (or masking it out of it). Outline Stroke must produce the same
  // paint, or converting a stroke to outlines shifts every edge by half the
  // stroke width relative to what the user was looking at.
  const square = (align: "center" | "inside" | "outside") => {
    const doc = makeDocument();
    const p = makePath(
      {
        closed: true,
        anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 100, y: 0 }), anchor({ x: 100, y: 100 }), anchor({ x: 0, y: 100 })],
      },
      { fill: noPaint(), stroke: { ...defaultStroke(solid(RED)), width: 20, align } },
    );
    Ops.Items.addItem(doc, p);
    return { doc, id: p.id };
  };
  const boundsAfter = (align: "center" | "inside" | "outside") => {
    const { doc, id } = square(align);
    const out = Ops.PathEdit.outlineStroke(doc, [id]);
    expect(out.length).toBeGreaterThan(0);
    return Query.worldBounds(doc, out[0])!;
  };

  it("centred stroke straddles the path (the existing behaviour)", () => {
    expect(boundsAfter("center")).toMatchObject({ x: -10, y: -10, width: 120, height: 120 });
  });

  it("inside stroke stays within the shape", () => {
    const b = boundsAfter("inside");
    expect(b.x).toBeCloseTo(0, 3);
    expect(b.y).toBeCloseTo(0, 3);
    expect(b.width).toBeCloseTo(100, 3);
    expect(b.height).toBeCloseTo(100, 3);
  });

  it("outside stroke sits entirely beyond the shape", () => {
    const b = boundsAfter("outside");
    expect(b.x).toBeCloseTo(-20, 3);
    expect(b.y).toBeCloseTo(-20, 3);
    expect(b.width).toBeCloseTo(140, 3);
    expect(b.height).toBeCloseTo(140, 3);
  });
});
