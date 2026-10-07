// ─────────────────────────────────────────────────────────────
// ops/arrowheads.test — Effect ▸ Stylize ▸ Add Arrowheads (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Reference: Illustrator's "Add Arrowheads" stamps a filled arrowhead onto the
// open end(s) of a stroked path, coloured with the stroke and pointing outward
// along the end tangent. Size = stroke width × (LEN back, HALF half-base) =
// (4w, 2w). The path + its head(s) are wrapped in one "Arrowheads" group.

import { describe, it, expect } from "vitest";
import { makeDocument, makePath, makeGroup, makeAnchor as anchor, noPaint, defaultStroke, solid, rgba, Ops, Query } from "../index";
import type { PathItem } from "../index";

const RED = rgba(220, 0, 0, 1);
const stroked = (w: number, paint = solid(RED)) => ({ ...defaultStroke(paint), width: w });
// A straight horizontal open path (0,0)→(100,0) with a `w`-wide stroke.
const line = (w = 10) => makePath({ closed: false, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 100, y: 0 })] }, { stroke: stroked(w) });
const pts = (g: { anchors: { point: { x: number; y: number } }[] }) => g.anchors.map((a) => ({ x: a.point.x + 0, y: a.point.y + 0 }));
const groupOf = (doc: ReturnType<typeof makeDocument>, id: string) => {
  const it = Query.getItem(doc, id)!;
  if (it.type !== "group") throw new Error("expected a group");
  return it;
};

describe("ops.arrowheads.arrowheadGeometry", () => {
  it("builds a triangle: apex at the tip, base set back along the direction", () => {
    // tip (100,0), pointing +x, width 10 ⇒ base 40 back, ±20 across.
    expect(pts(Ops.Arrowheads.arrowheadGeometry({ x: 100, y: 0 }, { x: 1, y: 0 }, 10))).toEqual([
      { x: 100, y: 0 },
      { x: 60, y: 20 },
      { x: 60, y: -20 },
    ]);
  });

  it("normalises the direction (non-unit input) and scales with width", () => {
    // dir (5,0) is normalised; width 20 ⇒ 80 back, ±40 across.
    expect(pts(Ops.Arrowheads.arrowheadGeometry({ x: 100, y: 0 }, { x: 5, y: 0 }, 20))).toEqual([
      { x: 100, y: 0 },
      { x: 20, y: 40 },
      { x: 20, y: -40 },
    ]);
  });

  it("orients a diagonal tangent (3-4-5): base swings perpendicular to the direction", () => {
    // dir (60,80) ⇒ u=(0.6,0.8); width 10 ⇒ back 40 along u = (36,48),
    // wing = perp(u)·20 = (−16,12).
    expect(pts(Ops.Arrowheads.arrowheadGeometry({ x: 60, y: 80 }, { x: 60, y: 80 }, 10))).toEqual([
      { x: 60, y: 80 },
      { x: 20, y: 60 },
      { x: 52, y: 36 },
    ]);
  });

  it("honours the scale multiplier (scale 2 doubles back + half-base)", () => {
    expect(pts(Ops.Arrowheads.arrowheadGeometry({ x: 100, y: 0 }, { x: 1, y: 0 }, 10, 2))).toEqual([
      { x: 100, y: 0 },
      { x: 20, y: 40 }, // 80 back, ±40 across (2× the width-10 head)
      { x: 20, y: -40 },
    ]);
  });
});

describe("ops.arrowheads.arrowheadGeometry — styles", () => {
  // tip (100,0), pointing +x, width 10 ⇒ HALF·w = 20 across, centred on the tip.
  it("square: a closed quad centred on the tip, half-side HALF·w", () => {
    const g = Ops.Arrowheads.arrowheadGeometry({ x: 100, y: 0 }, { x: 1, y: 0 }, 10, 1, "square");
    expect(g.closed).toBe(true);
    expect(pts(g)).toEqual([
      { x: 120, y: 20 },
      { x: 80, y: 20 },
      { x: 80, y: -20 },
      { x: 120, y: -20 },
    ]);
  });

  it("bar: a thin tick — half-thickness 0.5·w along the tangent, half-length HALF·w across", () => {
    const g = Ops.Arrowheads.arrowheadGeometry({ x: 100, y: 0 }, { x: 1, y: 0 }, 10, 1, "bar");
    expect(g.closed).toBe(true);
    expect(pts(g)).toEqual([
      { x: 105, y: 20 },
      { x: 95, y: 20 },
      { x: 95, y: -20 },
      { x: 105, y: -20 },
    ]);
  });

  it("square + bar orient to a diagonal (3-4-5) tangent", () => {
    // u=(0.6,0.8), perp=(−0.8,0.6); square half-extent 20 ⇒ ±(12,16) along u, ±(−16,12) across.
    const sq = Ops.Arrowheads.arrowheadGeometry({ x: 0, y: 0 }, { x: 3, y: 4 }, 10, 1, "square");
    expect(pts(sq)).toEqual([
      { x: -4, y: 28 }, // +u +perp = (12,16)+(−16,12)
      { x: -28, y: -4 }, // −u +perp = (−12,−16)+(−16,12)
      { x: 4, y: -28 }, // −u −perp
      { x: 28, y: 4 }, // +u −perp
    ]);
  });

  it("circle: a closed 4-anchor round dot, radius HALF·w, with curved (non-zero) handles", () => {
    const g = Ops.Arrowheads.arrowheadGeometry({ x: 100, y: 0 }, { x: 1, y: 0 }, 10, 1, "circle");
    expect(g.closed).toBe(true);
    expect(g.anchors.length).toBe(4);
    expect(pts(g)).toEqual([
      { x: 120, y: 0 }, // east
      { x: 100, y: 20 }, // south
      { x: 80, y: 0 }, // west
      { x: 100, y: -20 }, // north
    ]);
    // KAPPA bezier handles make it round, not a diamond: |handle| = r·KAPPA ≈ 11.05.
    expect(g.anchors[0].handleOut.y).toBeCloseTo(11.0457, 3);
    expect(g.anchors[0].handleIn.y).toBeCloseTo(-11.0457, 3);
    expect(g.anchors[1].handleIn.x).toBeCloseTo(11.0457, 3);
  });

  it("circle ignores the tangent direction (rotation-symmetric)", () => {
    const a = Ops.Arrowheads.arrowheadGeometry({ x: 0, y: 0 }, { x: 1, y: 0 }, 10, 1, "circle");
    const b = Ops.Arrowheads.arrowheadGeometry({ x: 0, y: 0 }, { x: 0, y: 1 }, 10, 1, "circle");
    expect(pts(a)).toEqual(pts(b)); // same dot whichever way the path points
  });

  it("styles still scale with stroke width × scale", () => {
    // width 10, scale 2 ⇒ HALF·w·scale = 40.
    const sq = Ops.Arrowheads.arrowheadGeometry({ x: 0, y: 0 }, { x: 1, y: 0 }, 10, 2, "square");
    expect(pts(sq)[0]).toEqual({ x: 40, y: 40 });
    const ci = Ops.Arrowheads.arrowheadGeometry({ x: 0, y: 0 }, { x: 1, y: 0 }, 10, 2, "circle");
    expect(pts(ci)[0]).toEqual({ x: 40, y: 0 }); // radius doubled
  });
});

describe("ops.arrowheads.addArrowheads", () => {
  it("End: wraps the path + a head pointing along the end tangent, head on top", () => {
    const doc = makeDocument();
    const p = line(10);
    Ops.Items.addItem(doc, p);
    const ids = Ops.Arrowheads.addArrowheads(doc, [p.id], "end");
    expect(ids.length).toBe(1);
    const grp = groupOf(doc, ids[0]);
    expect(doc.layers[0].items[0].id).toBe(grp.id); // group took the path's z-slot
    expect(grp.children.map((c) => c.id)[0]).toBe(p.id); // original underneath
    expect(grp.children.length).toBe(2);
    const head = grp.children[1] as PathItem;
    expect(pts(head.geometry)).toEqual([
      { x: 100, y: 0 }, // apex at the end
      { x: 60, y: 20 },
      { x: 60, y: -20 },
    ]);
  });

  it("colours the head with the stroke paint and gives it no stroke", () => {
    const doc = makeDocument();
    const p = line(10);
    Ops.Items.addItem(doc, p);
    const grp = groupOf(doc, Ops.Arrowheads.addArrowheads(doc, [p.id], "end")[0]);
    const head = grp.children[1] as PathItem;
    expect(head.fill).toEqual(solid(RED)); // takes the line colour
    expect(head.stroke.paint.type).toBe("none"); // the head itself isn't stroked
  });

  it("uses a stroke that exists only in the appearance stack", () => {
    const doc = makeDocument();
    const p = line(1);
    p.stroke = defaultStroke(noPaint());
    p.appearance = { entries: [
      { id: "legacy-none", kind: "stroke", stroke: defaultStroke(noPaint()) },
      { id: "visible", kind: "stroke", stroke: stroked(20) },
    ] };
    Ops.Items.addItem(doc, p);

    const grp = groupOf(doc, Ops.Arrowheads.addArrowheads(doc, [p.id], "end")[0]);
    const head = grp.children[1] as PathItem;
    expect(head.fill).toEqual(solid(RED));
    expect(pts(head.geometry)[1]).toEqual({ x: 20, y: 40 });
  });

  it("Start: the head points the other way (outward from the first anchor)", () => {
    const doc = makeDocument();
    const p = line(10);
    Ops.Items.addItem(doc, p);
    const grp = groupOf(doc, Ops.Arrowheads.addArrowheads(doc, [p.id], "start")[0]);
    expect(pts((grp.children[1] as PathItem).geometry)).toEqual([
      { x: 0, y: 0 }, // apex at the start
      { x: 40, y: -20 },
      { x: 40, y: 20 },
    ]);
  });

  it("Both: two heads, start then end, plus the original (3 children)", () => {
    const doc = makeDocument();
    const p = line(10);
    Ops.Items.addItem(doc, p);
    const grp = groupOf(doc, Ops.Arrowheads.addArrowheads(doc, [p.id], "both")[0]);
    expect(grp.children.length).toBe(3);
    expect((grp.children[1] as PathItem).geometry.anchors[0].point).toEqual({ x: 0, y: 0 }); // start head apex
    expect((grp.children[2] as PathItem).geometry.anchors[0].point).toEqual({ x: 100, y: 0 }); // end head apex
  });

  it("orients off the end bezier handle, not the straight chord", () => {
    const doc = makeDocument();
    // End anchor approaches vertically (handleIn points down), so the head points
    // up (0,−1) — unlike the +x chord, which would set the base at x=60.
    const p = makePath({ closed: false, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 100, y: 0 }, { x: 0, y: 40 })] }, { stroke: stroked(10) });
    Ops.Items.addItem(doc, p);
    const grp = groupOf(doc, Ops.Arrowheads.addArrowheads(doc, [p.id], "end")[0]);
    expect(pts((grp.children[1] as PathItem).geometry)).toEqual([
      { x: 100, y: 0 }, // apex
      { x: 120, y: 40 }, // base swung onto the vertical tangent
      { x: 80, y: 40 },
    ]);
  });

  it("head size scales with the stroke width", () => {
    const doc = makeDocument();
    const p = line(20); // width 20 ⇒ 80 back, ±40 across
    Ops.Items.addItem(doc, p);
    const grp = groupOf(doc, Ops.Arrowheads.addArrowheads(doc, [p.id], "end")[0]);
    expect(pts((grp.children[1] as PathItem).geometry)).toEqual([
      { x: 100, y: 0 },
      { x: 20, y: 40 },
      { x: 20, y: -40 },
    ]);
  });

  it("copies the path's transform onto each head so it stays aligned", () => {
    const doc = makeDocument();
    const tf = { a: 1, b: 0, c: 0, d: 1, e: 50, f: 20 }; // translate (50,20)
    const p = makePath({ closed: false, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 100, y: 0 })] }, { stroke: stroked(10), transform: tf });
    Ops.Items.addItem(doc, p);
    const grp = groupOf(doc, Ops.Arrowheads.addArrowheads(doc, [p.id], "end")[0]);
    expect((grp.children[1] as PathItem).transform).toEqual(tf); // head shares the line's frame
    expect(grp.transform).toEqual({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }); // the wrapping group itself is identity
  });

  it("skips a degenerate end (coincident anchors, no handles) without emitting a zero-size head", () => {
    const doc = makeDocument();
    // Two anchors at the same point: the end tangent is the zero vector → skipped.
    const p = makePath({ closed: false, anchors: [anchor({ x: 40, y: 40 }), anchor({ x: 40, y: 40 })] }, { stroke: stroked(10) });
    Ops.Items.addItem(doc, p);
    expect(Ops.Arrowheads.addArrowheads(doc, [p.id], "both")).toEqual([]); // no head, not wrapped
    expect(Query.getItem(doc, p.id)!.type).toBe("path");
  });

  it("bakes the requested style (square) onto the end, not a triangle", () => {
    const doc = makeDocument();
    const p = line(10); // (0,0)→(100,0), end tip (100,0)
    Ops.Items.addItem(doc, p);
    const grp = groupOf(doc, Ops.Arrowheads.addArrowheads(doc, [p.id], "end", "square")[0]);
    const head = grp.children[1] as PathItem;
    expect(head.geometry.closed).toBe(true);
    expect(pts(head.geometry)).toEqual([
      { x: 120, y: 20 },
      { x: 80, y: 20 },
      { x: 80, y: -20 },
      { x: 120, y: -20 },
    ]); // a square centred on the tip, not the 3-point triangle
  });

  it("is a no-op for closed paths, unstroked paths, short paths, and non-path items", () => {
    const doc = makeDocument();
    const closed = makePath({ closed: true, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 100, y: 0 }), anchor({ x: 50, y: 80 })] }, { stroke: stroked(10) });
    const noStroke = makePath({ closed: false, anchors: [anchor({ x: 0, y: 200 }), anchor({ x: 100, y: 200 })] }, { stroke: stroked(10, noPaint()) });
    const zeroW = makePath({ closed: false, anchors: [anchor({ x: 0, y: 300 }), anchor({ x: 100, y: 300 })] }, { stroke: stroked(0) });
    const single = makePath({ closed: false, anchors: [anchor({ x: 0, y: 400 })] }, { stroke: stroked(10) });
    const grp = makeGroup([line(10)]);
    Ops.Items.addItem(doc, closed);
    Ops.Items.addItem(doc, noStroke);
    Ops.Items.addItem(doc, zeroW);
    Ops.Items.addItem(doc, single);
    Ops.Items.addItem(doc, grp);
    expect(Ops.Arrowheads.addArrowheads(doc, [closed.id, noStroke.id, zeroW.id, single.id, grp.id], "both")).toEqual([]);
    expect(Query.getItem(doc, closed.id)!.type).toBe("path"); // untouched, not wrapped
    expect(Query.getItem(doc, grp.id)!.type).toBe("group");
  });
});
