// ─────────────────────────────────────────────────────────────
// ops/free-distort.test — Effect ▸ Distort & Transform ▸ Free Distort (parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Free Distort — drag the four bbox corners freely;
// the object is remapped by bilinear interpolation of its bounding box onto the
// new quadrilateral. We verify the corner mapping exactly, that an identity quad
// is a no-op, that smooth handles stay smooth (Jacobian map), live→path
// conversion, compound subpaths, and the degenerate-bbox skip.

import { describe, it, expect } from "vitest";
import { makeDocument, makePath, makeCompound, makeStar, makeAnchor as anchor, Ops, Query, solid, rgba } from "../index";
import type { PathItem } from "../index";
import type { FreeDistortCorners } from "./free-distort";

const RED = rgba(220, 0, 0);
const geomOf = (doc: ReturnType<typeof makeDocument>, id: string) => (Query.getItem(doc, id) as PathItem).geometry;
const nearPt = (p: { x: number; y: number }, x: number, y: number) => {
  expect(p.x).toBeCloseTo(x, 6);
  expect(p.y).toBeCloseTo(y, 6);
};

// Perspective trapezoid: pull the TOP edge inward 20% on each side, leave the
// bottom edge full width — the canonical "perspective" Free Distort.
const PERSPECTIVE: FreeDistortCorners = {
  topLeft: { x: 0.2, y: 0 },
  topRight: { x: 0.8, y: 0 },
  bottomRight: { x: 1, y: 1 },
  bottomLeft: { x: 0, y: 1 },
};

const IDENTITY: FreeDistortCorners = {
  topLeft: { x: 0, y: 0 },
  topRight: { x: 1, y: 0 },
  bottomRight: { x: 1, y: 1 },
  bottomLeft: { x: 0, y: 1 },
};

// A unit-square bbox [0,0]→[100,100] so (u,v) reads straight off the coordinates.
const square = () => ({
  closed: true,
  anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 100, y: 0 }), anchor({ x: 100, y: 100 }), anchor({ x: 0, y: 100 })],
});

describe("ops.freeDistort.freeDistort", () => {
  it("maps each corner by the bilinear quad: top edge narrows, bottom edge pinned", () => {
    const doc = makeDocument();
    const p = makePath(square(), { fill: solid(RED) });
    Ops.Items.addItem(doc, p);
    const ids = Ops.FreeDistort.freeDistort(doc, [p.id], PERSPECTIVE);
    expect(ids).toEqual([p.id]);
    const g = geomOf(doc, p.id);
    nearPt(g.anchors[0].point, 20, 0); // TL → 0.2·100
    nearPt(g.anchors[1].point, 80, 0); // TR → 0.8·100
    nearPt(g.anchors[2].point, 100, 100); // BR pinned
    nearPt(g.anchors[3].point, 0, 100); // BL pinned
  });

  it("interpolates interior/edge points bilinearly (top-edge midpoint stays centred)", () => {
    const doc = makeDocument();
    // add a midpoint on the top edge (u=0.5, v=0) and the centre (u=0.5, v=0.5)
    const p = makePath(
      { closed: true, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 50, y: 0 }), anchor({ x: 100, y: 0 }), anchor({ x: 50, y: 50 })] },
      { fill: solid(RED) },
    );
    Ops.Items.addItem(doc, p);
    Ops.FreeDistort.freeDistort(doc, [p.id], PERSPECTIVE);
    const g = geomOf(doc, p.id);
    nearPt(g.anchors[1].point, 50, 0); // top-edge midpoint: 0.5·(0.2+0.8)·100 = 50, unmoved in x
    // centre (0.5,0.5): x = ((1-v)·0.5·(0.2+0.8) + v·0.5·(1+0))·100 with v=0.5 → 50; y = 50
    nearPt(g.anchors[3].point, 50, 50);
  });

  it("is a no-op (returns []) for an identity quad", () => {
    const doc = makeDocument();
    const p = makePath(square());
    Ops.Items.addItem(doc, p);
    expect(Ops.FreeDistort.freeDistort(doc, [p.id], IDENTITY)).toEqual([]);
    nearPt(geomOf(doc, p.id).anchors[1].point, 100, 0); // unchanged
  });

  it("keeps a smooth anchor smooth: handles ride one linear Jacobian (no kinking)", () => {
    // An affine horizontal shear (constant Jacobian): bottom edge shifted +0.5w.
    const shear: FreeDistortCorners = {
      topLeft: { x: 0, y: 0 },
      topRight: { x: 1, y: 0 },
      bottomRight: { x: 1.5, y: 1 },
      bottomLeft: { x: 0.5, y: 1 },
    };
    const doc = makeDocument();
    // an interior smooth anchor at the centre (u=v=0.5) with handleIn = −handleOut
    const p = makePath({
      closed: true,
      anchors: [
        anchor({ x: 0, y: 0 }),
        anchor({ x: 100, y: 0 }),
        anchor({ x: 100, y: 100 }),
        anchor({ x: 0, y: 100 }),
        anchor({ x: 50, y: 50 }, { x: 0, y: -12 }, { x: 0, y: 12 }),
      ],
    });
    Ops.Items.addItem(doc, p);
    Ops.FreeDistort.freeDistort(doc, [p.id], shear);
    const a = geomOf(doc, p.id).anchors[4];
    // J(unit) = [[1,0.5],[0,1]] → world handle (0,12) → (6,12); smoothness kept.
    nearPt(a.handleOut, 6, 12);
    nearPt(a.handleIn, -6, -12);
    nearPt(a.handleIn, -a.handleOut.x, -a.handleOut.y); // collinear & opposite
  });

  it("converts a live star to a path before distorting it", () => {
    const doc = makeDocument();
    const star = makeStar(50, 50, 50, 25, 5, { fill: solid(RED) });
    Ops.Items.addItem(doc, star);
    expect(Ops.FreeDistort.freeDistort(doc, [star.id], PERSPECTIVE)).toEqual([star.id]);
    expect(Query.getItem(doc, star.id)!.type).toBe("path");
  });

  it("distorts every subpath of a compound about the shared bbox", () => {
    const doc = makeDocument();
    const comp = makeCompound([square()], { fill: solid(RED) });
    Ops.Items.addItem(doc, comp);
    expect(Ops.FreeDistort.freeDistort(doc, [comp.id], PERSPECTIVE)).toEqual([comp.id]);
    const it = Query.getItem(doc, comp.id)!;
    if (it.type !== "compound") throw new Error("expected compound");
    nearPt(it.subpaths[0].anchors[0].point, 20, 0); // same TL mapping as the bare path
    nearPt(it.subpaths[0].anchors[2].point, 100, 100);
  });

  it("skips a degenerate (zero-height) bbox — can't normalize a flat line", () => {
    const doc = makeDocument();
    const line = makePath({ closed: false, anchors: [anchor({ x: 0, y: 50 }), anchor({ x: 100, y: 50 })] });
    Ops.Items.addItem(doc, line);
    expect(Ops.FreeDistort.freeDistort(doc, [line.id], PERSPECTIVE)).toEqual([]);
    nearPt(geomOf(doc, line.id).anchors[0].point, 0, 50); // untouched
  });
});
