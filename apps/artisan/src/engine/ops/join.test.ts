// ─────────────────────────────────────────────────────────────
// ops/join.test — Object ▸ Path ▸ Join (⌘J) — Illustrator parity
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator "Join" — joins the endpoints of selected open
// paths. A single open path is closed; two are connected at their NEAREST
// endpoints with a straight segment; two endpoints at the SAME location merge
// into a single anchor (no zero-length segment).

import { describe, it, expect } from "vitest";
import { makeDocument, makePath, makeAnchor as anchor, Ops, Query } from "../index";

const pts = (doc: ReturnType<typeof makeDocument>, id: string) => {
  const it = Query.getItem(doc, id)!;
  return it.type === "path" ? it.geometry.anchors.map((a) => [a.point.x, a.point.y]) : [];
};
const addOpen = (doc: ReturnType<typeof makeDocument>, anchors: ReturnType<typeof anchor>[]) => {
  const p = makePath({ closed: false, anchors });
  Ops.Items.addItem(doc, p);
  return p;
};

describe("ops.join — single path", () => {
  it("closes an open path whose endpoints are distinct (anchor count unchanged)", () => {
    const doc = makeDocument();
    const p = addOpen(doc, [anchor({ x: 0, y: 0 }), anchor({ x: 10, y: 0 }), anchor({ x: 10, y: 10 })]);
    Ops.PathEdit.joinPaths(doc, [p.id]);
    const it = Query.getItem(doc, p.id)!;
    expect(it.type === "path" && it.geometry.closed).toBe(true);
    expect(it.type === "path" && it.geometry.anchors.length).toBe(3);
  });

  it("merges coincident endpoints into one anchor, then closes", () => {
    const doc = makeDocument();
    // first and last anchor are at the same spot (0,0)
    const p = addOpen(doc, [anchor({ x: 0, y: 0 }), anchor({ x: 10, y: 0 }), anchor({ x: 0, y: 0 })]);
    Ops.PathEdit.joinPaths(doc, [p.id]);
    const it = Query.getItem(doc, p.id)!;
    expect(it.type === "path" && it.geometry.closed).toBe(true);
    expect(pts(doc, p.id)).toEqual([[0, 0], [10, 0]]); // duplicate dropped
  });
});

describe("ops.join — two paths", () => {
  it("connects the nearest endpoints (distinct → 4 anchors)", () => {
    const doc = makeDocument();
    const a = addOpen(doc, [anchor({ x: 0, y: 0 }), anchor({ x: 10, y: 0 })]);
    const b = addOpen(doc, [anchor({ x: 12, y: 0 }), anchor({ x: 20, y: 0 })]);
    const nid = Ops.PathEdit.joinPaths(doc, [a.id, b.id])!;
    expect(doc.layers[0].items.length).toBe(1);
    expect(pts(doc, nid)).toEqual([[0, 0], [10, 0], [12, 0], [20, 0]]);
  });

  it("merges a SHARED endpoint into a single anchor (3 anchors, no duplicate)", () => {
    const doc = makeDocument();
    const a = addOpen(doc, [anchor({ x: 0, y: 0 }), anchor({ x: 10, y: 0 })]);
    const b = addOpen(doc, [anchor({ x: 10, y: 0 }), anchor({ x: 20, y: 0 })]); // shares (10,0)
    const nid = Ops.PathEdit.joinPaths(doc, [a.id, b.id])!;
    expect(pts(doc, nid)).toEqual([[0, 0], [10, 0], [20, 0]]);
  });

  it("orients the FIRST path to its nearest endpoint (no crossing connector)", () => {
    const doc = makeDocument();
    // `a` is drawn right→left so its tail is (0,0); the nearer endpoint to b is (10,0).
    const a = addOpen(doc, [anchor({ x: 10, y: 0 }), anchor({ x: 0, y: 0 })]);
    const b = addOpen(doc, [anchor({ x: 20, y: 0 }), anchor({ x: 30, y: 0 })]);
    const nid = Ops.PathEdit.joinPaths(doc, [a.id, b.id])!;
    // nearest endpoints (10,0)↔(20,0) connect → monotonic, no back-track
    expect(pts(doc, nid)).toEqual([[0, 0], [10, 0], [20, 0], [30, 0]]);
  });

  it("preserves the outgoing handle of the merged-away anchor", () => {
    const doc = makeDocument();
    const a = addOpen(doc, [anchor({ x: 0, y: 0 }), anchor({ x: 10, y: 0 }, { x: -2, y: 0 }, { x: 0, y: 0 })]);
    const b = addOpen(doc, [anchor({ x: 10, y: 0 }, { x: 0, y: 0 }, { x: 3, y: 0 }), anchor({ x: 20, y: 0 })]);
    const nid = Ops.PathEdit.joinPaths(doc, [a.id, b.id])!;
    const merged = (Query.getItem(doc, nid)! as Extract<ReturnType<typeof Query.getItem>, { type: "path" }>).geometry.anchors[1];
    expect(merged.point).toEqual({ x: 10, y: 0 });
    expect(merged.handleIn).toEqual({ x: -2, y: 0 }); // from a's endpoint
    expect(merged.handleOut).toEqual({ x: 3, y: 0 }); // from b's endpoint
  });
});
