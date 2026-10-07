// ─────────────────────────────────────────────────────────────
// ops/reverse-path.test — Object ▸ Path ▸ Reverse Path Direction (parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Reverse Path Direction — flips the path's
// direction (start/end swap, winding reverses). Geometrically: reverse the anchor
// order and swap each anchor's in/out handles.

import { describe, it, expect } from "vitest";
import { makeDocument, makePath, makeCompound, makeRect, makeText, makeAnchor as anchor, Ops, Query, solid, rgba } from "../index";
import type { PathItem } from "../index";

const RED = rgba(220, 0, 0);
const geomOf = (doc: ReturnType<typeof makeDocument>, id: string) => (Query.getItem(doc, id) as PathItem).geometry;
const pts = (doc: ReturnType<typeof makeDocument>, id: string) => geomOf(doc, id).anchors.map((a) => [a.point.x, a.point.y]);

describe("ops.reverse-path.reversePath", () => {
  it("reverses the anchor order of an open path", () => {
    const doc = makeDocument();
    const p = makePath({ closed: false, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 100, y: 0 }), anchor({ x: 100, y: 100 })] });
    Ops.Items.addItem(doc, p);
    const ids = Ops.ReversePath.reversePath(doc, [p.id]);
    expect(ids).toEqual([p.id]);
    expect(pts(doc, p.id)).toEqual([[100, 100], [100, 0], [0, 0]]);
  });

  it("swaps each anchor's in/out handles", () => {
    const doc = makeDocument();
    const mid = anchor({ x: 50, y: 0 }, { x: -5, y: 1 }, { x: 5, y: -1 });
    const p = makePath({ closed: false, anchors: [anchor({ x: 0, y: 0 }), mid, anchor({ x: 100, y: 0 })] });
    Ops.Items.addItem(doc, p);
    Ops.ReversePath.reversePath(doc, [p.id]);
    const reversedMid = geomOf(doc, p.id).anchors.find((a) => a.point.x === 50)!;
    expect(reversedMid.handleIn).toEqual({ x: 5, y: -1 }); // was handleOut
    expect(reversedMid.handleOut).toEqual({ x: -5, y: 1 }); // was handleIn
  });

  it("preserves the closed flag", () => {
    const doc = makeDocument();
    const p = makePath({ closed: true, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 10, y: 0 }), anchor({ x: 10, y: 10 })] });
    Ops.Items.addItem(doc, p);
    Ops.ReversePath.reversePath(doc, [p.id]);
    expect(geomOf(doc, p.id).closed).toBe(true);
  });

  it("reverses each subpath of a compound path", () => {
    const doc = makeDocument();
    const comp = makeCompound(
      [
        { closed: true, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 10, y: 0 }), anchor({ x: 10, y: 10 })] },
        { closed: true, anchors: [anchor({ x: 20, y: 20 }), anchor({ x: 30, y: 20 }), anchor({ x: 30, y: 30 })] },
      ],
      { fill: solid(RED) },
    );
    Ops.Items.addItem(doc, comp);
    Ops.ReversePath.reversePath(doc, [comp.id]);
    const it = Query.getItem(doc, comp.id)!;
    if (it.type !== "compound") throw new Error("expected compound");
    expect(it.subpaths[0].anchors.map((a) => [a.point.x, a.point.y])).toEqual([[10, 10], [10, 0], [0, 0]]);
    expect(it.subpaths[1].anchors.map((a) => [a.point.x, a.point.y])).toEqual([[30, 30], [30, 20], [20, 20]]);
  });

  it("converts a live shape to a path and reverses it", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 100, 50, 0, 0, { fill: solid(RED) });
    Ops.Items.addItem(doc, r);
    Ops.ReversePath.reversePath(doc, [r.id]);
    const it = Query.getItem(doc, r.id)!;
    expect(it.type).toBe("path");
    if (it.type === "path") {
      // rectPath order is (0,0)(100,0)(100,50)(0,50); reversed starts at (0,50)
      expect(it.geometry.anchors[0].point).toEqual({ x: 0, y: 50 });
      expect(it.geometry.anchors).toHaveLength(4);
    }
  });

  it("ignores objects without path geometry (text)", () => {
    const doc = makeDocument();
    const t = makeText("Hi", 0, 0);
    Ops.Items.addItem(doc, t);
    expect(Ops.ReversePath.reversePath(doc, [t.id])).toEqual([]);
    expect(Query.getItem(doc, t.id)!.type).toBe("text");
  });
});
