// ─────────────────────────────────────────────────────────────
// ops/smooth.test — Smooth tool primitive smoothNear (parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Smooth tool softens a path by nudging each anchor
// toward the midpoint of its neighbours, with falloff from the brush centre.

import { describe, it, expect } from "vitest";
import { makeDocument, makePath, makeAnchor as anchor, Ops, Query } from "../index";

const pts = (doc: ReturnType<typeof makeDocument>, id: string) =>
  (Query.getItem(doc, id) as { geometry: { anchors: { point: { x: number; y: number } }[] } }).geometry.anchors.map((a) => a.point);

describe("ops.path-edit.smoothNear", () => {
  it("moves an anchor at the brush centre fully to its neighbours' midpoint (amount 1)", () => {
    const doc = makeDocument();
    const p = makePath({ closed: false, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 50, y: 100 }), anchor({ x: 100, y: 0 })] });
    Ops.Items.addItem(doc, p);
    Ops.PathEdit.smoothNear(doc, p.id, { x: 50, y: 100 }, 60, 1);
    expect(pts(doc, p.id)).toEqual([
      { x: 0, y: 0 }, // outside the radius
      { x: 50, y: 0 }, // spike flattened to the midpoint of (0,0)+(100,0)
      { x: 100, y: 0 },
    ]);
  });

  it("respects the amount (partial smoothing)", () => {
    const doc = makeDocument();
    const p = makePath({ closed: false, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 50, y: 100 }), anchor({ x: 100, y: 0 })] });
    Ops.Items.addItem(doc, p);
    Ops.PathEdit.smoothNear(doc, p.id, { x: 50, y: 100 }, 60, 0.5);
    expect(pts(doc, p.id)[1]).toEqual({ x: 50, y: 50 }); // halfway toward (50,0)
  });

  it("uses one-sided neighbours at open-path endpoints", () => {
    const doc = makeDocument();
    const p = makePath({ closed: false, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 100, y: 0 }), anchor({ x: 100, y: 100 })] });
    Ops.Items.addItem(doc, p);
    Ops.PathEdit.smoothNear(doc, p.id, { x: 0, y: 0 }, 1, 1);
    expect(pts(doc, p.id)[0]).toEqual({ x: 50, y: 0 });
  });

  it("leaves anchors outside the brush radius untouched", () => {
    const doc = makeDocument();
    const p = makePath({ closed: false, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 50, y: 100 }), anchor({ x: 100, y: 0 })] });
    Ops.Items.addItem(doc, p);
    const before = pts(doc, p.id);
    Ops.PathEdit.smoothNear(doc, p.id, { x: 500, y: 500 }, 40, 1); // far from every anchor
    expect(pts(doc, p.id)).toEqual(before);
  });

  it("is a no-op on a path with fewer than 3 anchors", () => {
    const doc = makeDocument();
    const p = makePath({ closed: false, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 50, y: 50 })] });
    Ops.Items.addItem(doc, p);
    const before = pts(doc, p.id);
    Ops.PathEdit.smoothNear(doc, p.id, { x: 50, y: 50 }, 60, 1);
    expect(pts(doc, p.id)).toEqual(before);
  });
});
