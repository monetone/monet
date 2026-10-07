// ─────────────────────────────────────────────────────────────
// ops/transform-each.test — Object ▸ Transform ▸ Transform Each (parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Transform Each — applies the same scale / rotate /
// move to EACH selected object around its OWN reference point (centre), not the
// shared selection centre. Reflect X/Y are sign flips on the scale.

import { describe, it, expect } from "vitest";
import { makeDocument, makeRect, makePath, makeAnchor as anchor, Ops, Query, solid, rgba } from "../index";

const RED = rgba(220, 0, 0);
const box = (doc: ReturnType<typeof makeDocument>, id: string) => Query.worldBounds(doc, id)!;

describe("ops.transform-each.transformEach", () => {
  it("scales EACH object around its own centre (not the shared centre)", () => {
    const doc = makeDocument();
    const a = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(RED) }); // centre (20,20)
    const b = makeRect(100, 0, 60, 60, 0, 0, { fill: solid(RED) }); // centre (130,30)
    Ops.Items.addItem(doc, a);
    Ops.Items.addItem(doc, b);

    Ops.TransformEach.transformEach(doc, [a.id, b.id], { scaleX: 0.5, scaleY: 0.5 });

    const ba = box(doc, a.id);
    const bb = box(doc, b.id);
    // each halved in place, its own centre fixed
    expect([ba.x, ba.y, ba.width, ba.height]).toEqual([10, 10, 20, 20]); // centre still (20,20)
    expect([bb.x, bb.y, bb.width, bb.height]).toEqual([115, 15, 30, 30]); // centre still (130,30)
  });

  it("moves each object by the same delta", () => {
    const doc = makeDocument();
    const a = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(RED) });
    Ops.Items.addItem(doc, a);
    Ops.TransformEach.transformEach(doc, [a.id], { moveX: 10, moveY: -5 });
    const b = box(doc, a.id);
    expect([b.x, b.y, b.width, b.height]).toEqual([10, -5, 40, 40]);
  });

  it("rotates each object around its own centre (non-square bounds swap)", () => {
    const doc = makeDocument();
    const a = makeRect(0, 0, 40, 20, 0, 0, { fill: solid(RED) }); // centre (20,10)
    Ops.Items.addItem(doc, a);
    Ops.TransformEach.transformEach(doc, [a.id], { rotate: Math.PI / 2 });
    const b = box(doc, a.id);
    // 40×20 rotated 90° about (20,10) → 20×40, centre unchanged
    expect(b.x).toBeCloseTo(10, 6);
    expect(b.y).toBeCloseTo(-10, 6);
    expect(b.width).toBeCloseTo(20, 6);
    expect(b.height).toBeCloseTo(40, 6);
  });

  it("reflectX flips the orientation (transform determinant goes negative)", () => {
    const doc = makeDocument();
    const tri = makePath({ closed: true, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 20, y: 0 }), anchor({ x: 0, y: 20 })] }, { fill: solid(RED) });
    Ops.Items.addItem(doc, tri);
    const det = (id: string) => {
      const m = Query.getItem(doc, id)!.transform;
      return m.a * m.d - m.b * m.c;
    };
    expect(det(tri.id)).toBeGreaterThan(0); // identity-ish
    Ops.TransformEach.transformEach(doc, [tri.id], { reflectX: true });
    expect(det(tri.id)).toBeLessThan(0); // mirrored
    // a reflection keeps the bounding box
    const b = box(doc, tri.id);
    expect([b.x, b.y, b.width, b.height]).toEqual([0, 0, 20, 20]);
  });

  it("is a no-op with default (100%, no move/rotate) options", () => {
    const doc = makeDocument();
    const a = makeRect(10, 20, 40, 40, 0, 0, { fill: solid(RED) });
    Ops.Items.addItem(doc, a);
    const before = box(doc, a.id);
    Ops.TransformEach.transformEach(doc, [a.id], {});
    const after = box(doc, a.id);
    expect([after.x, after.y, after.width, after.height]).toEqual([before.x, before.y, before.width, before.height]);
  });
});
