// ─────────────────────────────────────────────────────────────
// ops/convert-anchors.test — Convert anchor points to corner / smooth (parity)
// ─────────────────────────────────────────────────────────────
// Reference: Illustrator's Control/Properties "Convert" buttons act on every
// selected anchor at once — corner removes the handles, smooth gives the anchor
// handles tangent to its neighbours (handleOut = (next−prev)/6, handleIn mirror).

import { describe, it, expect } from "vitest";
import { makeDocument, makePath, makeAnchor as anchor, Ops, Query } from "../index";
import type { PathItem } from "../index";

const path = (doc: ReturnType<typeof makeDocument>, id: string) => Query.getItem(doc, id) as PathItem;
// A closed unit-ish square 0,0 → 120,0 → 120,120 → 0,120 (all corners).
const square = () =>
  makePath({
    closed: true,
    anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 120, y: 0 }), anchor({ x: 120, y: 120 }), anchor({ x: 0, y: 120 })],
  });

describe("ops.path-edit.smoothAnchor", () => {
  it("gives a corner handles tangent to its neighbours (closed path wraps)", () => {
    const doc = makeDocument();
    const p = square();
    Ops.Items.addItem(doc, p);
    expect(Ops.PathEdit.smoothAnchor(doc, p.id, 1)).toBe(true); // anchor (120,0)
    const a = path(doc, p.id).geometry.anchors[1];
    // prev (0,0), next (120,120) ⇒ (next−prev)/6 = (20,20).
    expect(a.handleOut).toEqual({ x: 20, y: 20 });
    expect(a.handleIn).toEqual({ x: -20, y: -20 });
  });

  it("clamps to itself at an open-path endpoint (one-sided tangent)", () => {
    const doc = makeDocument();
    const p = makePath({ closed: false, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 60, y: 30 }), anchor({ x: 60, y: 90 })] });
    Ops.Items.addItem(doc, p);
    expect(Ops.PathEdit.smoothAnchor(doc, p.id, 0)).toBe(true); // first endpoint
    const a = path(doc, p.id).geometry.anchors[0];
    // prev clamps to self (0,0), next (60,30) ⇒ ((60−0)/6, (30−0)/6) = (10,5).
    expect(a.handleOut).toEqual({ x: 10, y: 5 });
    expect(a.handleIn).toEqual({ x: -10, y: -5 });
  });

  it("is a no-op (returns false) when the anchor is already smooth", () => {
    const doc = makeDocument();
    const p = square();
    Ops.Items.addItem(doc, p);
    Ops.PathEdit.smoothAnchor(doc, p.id, 1);
    const before = { ...path(doc, p.id).geometry.anchors[1].handleOut };
    expect(Ops.PathEdit.smoothAnchor(doc, p.id, 1)).toBe(false); // already smooth
    expect(path(doc, p.id).geometry.anchors[1].handleOut).toEqual(before); // unchanged
  });

  it("is a no-op for a degenerate tangent (single-anchor path)", () => {
    const doc = makeDocument();
    const p = makePath({ closed: false, anchors: [anchor({ x: 5, y: 5 })] });
    Ops.Items.addItem(doc, p);
    expect(Ops.PathEdit.smoothAnchor(doc, p.id, 0)).toBe(false);
    expect(path(doc, p.id).geometry.anchors[0].handleOut).toEqual({ x: 0, y: 0 });
  });
});

describe("ops.path-edit.cornerAnchor", () => {
  it("zeros the handles of a smooth anchor and reports the change", () => {
    const doc = makeDocument();
    const p = square();
    Ops.Items.addItem(doc, p);
    Ops.PathEdit.smoothAnchor(doc, p.id, 2);
    expect(Ops.PathEdit.cornerAnchor(doc, p.id, 2)).toBe(true);
    expect(path(doc, p.id).geometry.anchors[2].handleOut).toEqual({ x: 0, y: 0 });
    expect(path(doc, p.id).geometry.anchors[2].handleIn).toEqual({ x: 0, y: 0 });
  });

  it("is a no-op (returns false) on an already-corner anchor", () => {
    const doc = makeDocument();
    const p = square();
    Ops.Items.addItem(doc, p);
    expect(Ops.PathEdit.cornerAnchor(doc, p.id, 0)).toBe(false);
  });
});

describe("ops.path-edit.convertAnchors (batch)", () => {
  it("smooths every selected anchor across paths and reports changed", () => {
    const doc = makeDocument();
    const p = square();
    Ops.Items.addItem(doc, p);
    expect(Ops.PathEdit.convertAnchors(doc, { [p.id]: [0, 1, 2, 3] }, "smooth")).toBe(true);
    for (const a of path(doc, p.id).geometry.anchors) {
      expect(a.handleOut.x !== 0 || a.handleOut.y !== 0).toBe(true); // all now smooth
    }
  });

  it("corners every selected anchor and reports changed", () => {
    const doc = makeDocument();
    const p = square();
    Ops.Items.addItem(doc, p);
    Ops.PathEdit.convertAnchors(doc, { [p.id]: [0, 1, 2, 3] }, "smooth");
    expect(Ops.PathEdit.convertAnchors(doc, { [p.id]: [0, 1, 2, 3] }, "corner")).toBe(true);
    for (const a of path(doc, p.id).geometry.anchors) {
      expect(a.handleIn).toEqual({ x: 0, y: 0 });
      expect(a.handleOut).toEqual({ x: 0, y: 0 });
    }
  });

  it("returns false when no selected anchor changes (all already corners → corner)", () => {
    const doc = makeDocument();
    const p = square();
    Ops.Items.addItem(doc, p);
    expect(Ops.PathEdit.convertAnchors(doc, { [p.id]: [0, 1, 2, 3] }, "corner")).toBe(false);
  });
});

describe("ops.path-edit.anchorsNeedConvert (predicate)", () => {
  it("smooth: true when a selected anchor is a corner, false once all are smooth", () => {
    const doc = makeDocument();
    const p = square();
    Ops.Items.addItem(doc, p);
    expect(Ops.PathEdit.anchorsNeedConvert(doc, { [p.id]: [0, 1] }, "smooth")).toBe(true);
    Ops.PathEdit.convertAnchors(doc, { [p.id]: [0, 1] }, "smooth");
    expect(Ops.PathEdit.anchorsNeedConvert(doc, { [p.id]: [0, 1] }, "smooth")).toBe(false);
  });

  it("corner: true only when a selected anchor still has handles", () => {
    const doc = makeDocument();
    const p = square();
    Ops.Items.addItem(doc, p);
    expect(Ops.PathEdit.anchorsNeedConvert(doc, { [p.id]: [0, 1] }, "corner")).toBe(false); // all corners
    Ops.PathEdit.smoothAnchor(doc, p.id, 1);
    expect(Ops.PathEdit.anchorsNeedConvert(doc, { [p.id]: [1] }, "corner")).toBe(true);
  });

  it("smooth: false for a degenerate corner (zero tangent) — predicate matches the op's mutation set", () => {
    const doc = makeDocument();
    // Two coincident points: anchor 0 lacks handles, but prev (clamped self) === next
    // ⇒ smoothAnchor cannot act, so the predicate must NOT claim a change.
    const p = makePath({ closed: false, anchors: [anchor({ x: 5, y: 5 }), anchor({ x: 5, y: 5 })] });
    Ops.Items.addItem(doc, p);
    expect(Ops.PathEdit.anchorsNeedConvert(doc, { [p.id]: [0] }, "smooth")).toBe(false);
    expect(Ops.PathEdit.convertAnchors(doc, { [p.id]: [0] }, "smooth")).toBe(false); // op agrees — no divergence
  });
});
