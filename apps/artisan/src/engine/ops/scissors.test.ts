// ─────────────────────────────────────────────────────────────
// ops/scissors.test — Scissors tool engine op cutPathAt (parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Scissors (C) splits a path at a clicked point,
// adding two coincident anchor points at the cut. Cutting a CLOSED path once
// opens it into a single open path; cutting an OPEN path splits it into two
// separate open paths. The pieces keep the original paint.

import { describe, it, expect } from "vitest";
import { makeDocument, makePath, makeAnchor as anchor, makeRect, Ops, Query, solid, rgba } from "../index";

const RED = rgba(220, 0, 0);
const pts = (g: { anchors: { point: { x: number; y: number } }[] }) => g.anchors.map((a) => [a.point.x, a.point.y]);
const geomOf = (doc: ReturnType<typeof makeDocument>, id: string) =>
  (Query.getItem(doc, id) as { geometry: { anchors: { point: { x: number; y: number } }[]; closed: boolean } }).geometry;

describe("ops.path-edit.cutPathAt (Scissors)", () => {
  it("cutting a CLOSED path once opens it into ONE path with coincident ends at the cut", () => {
    const doc = makeDocument();
    const sq = makePath(
      { closed: true, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 100, y: 0 }), anchor({ x: 100, y: 100 }), anchor({ x: 0, y: 100 })] },
      { fill: solid(RED) },
    );
    Ops.Items.addItem(doc, sq);
    Ops.PathEdit.cutPathAt(doc, sq.id, 0, 0.5); // mid top edge → (50,0)
    expect(doc.layers[0].items.length).toBe(1); // still one item (opened, not split)
    const g = geomOf(doc, sq.id);
    expect(g.closed).toBe(false);
    expect(g.anchors.length).toBe(6); // 4 + inserted cut + duplicated end
    expect(g.anchors[0].point).toEqual({ x: 50, y: 0 }); // starts at the cut
    expect(g.anchors[g.anchors.length - 1].point).toEqual({ x: 50, y: 0 }); // …and ends there
  });

  it("cutting an OPEN path splits it into TWO paths sharing the cut point", () => {
    const doc = makeDocument();
    const p = makePath(
      { closed: false, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 100, y: 0 }), anchor({ x: 200, y: 0 })] },
      { fill: solid(RED) },
    );
    Ops.Items.addItem(doc, p);
    Ops.PathEdit.cutPathAt(doc, p.id, 0, 0.5); // cut first segment at (50,0)
    expect(doc.layers[0].items.length).toBe(2);
    const first = geomOf(doc, p.id); // original keeps its id = first half
    const second = (doc.layers[0].items[1] as { geometry: { anchors: { point: { x: number; y: number } }[]; closed: boolean } }).geometry;
    expect(pts(first)).toEqual([[0, 0], [50, 0]]);
    expect(first.closed).toBe(false);
    expect(pts(second)).toEqual([[50, 0], [100, 0], [200, 0]]);
    expect(second.closed).toBe(false);
  });

  it("both halves of an open cut keep the original fill", () => {
    const doc = makeDocument();
    const p = makePath({ closed: false, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 100, y: 0 })] }, { fill: solid(RED) });
    Ops.Items.addItem(doc, p);
    Ops.PathEdit.cutPathAt(doc, p.id, 0, 0.5);
    const [a, b] = doc.layers[0].items;
    expect(a.fill).toEqual(solid(RED));
    expect(b.fill).toEqual(solid(RED));
  });

  it("gives the two halves INDEPENDENT paint objects (AR-M5)", () => {
    const doc = makeDocument();
    const p = makePath({ closed: false, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 100, y: 0 })] }, { fill: solid(RED) });
    Ops.Items.addItem(doc, p);
    Ops.PathEdit.cutPathAt(doc, p.id, 0, 0.5);
    const [a, b] = doc.layers[0].items;
    expect(a.fill).not.toBe(b.fill); // not the SAME object — editing one must not alias the other
    Ops.Paint.applyFill(doc, [a.id], solid(rgba(0, 0, 255))); // recolor half A
    expect(b.fill).toEqual(solid(RED)); // half B unaffected
  });

  it("is a no-op on a non-path item (a live shape must be converted first)", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 50, 50, 0, 0, { fill: solid(RED) });
    Ops.Items.addItem(doc, r);
    Ops.PathEdit.cutPathAt(doc, r.id, 0, 0.5);
    expect(doc.layers[0].items.length).toBe(1);
    expect(Query.getItem(doc, r.id)?.type).toBe("rect"); // untouched
  });
});
