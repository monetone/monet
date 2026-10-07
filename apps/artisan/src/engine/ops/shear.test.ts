// ─────────────────────────────────────────────────────────────
// ops/shear.test — Object transform shear / skew (parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Shear (Skew) tool. A horizontal shear slants the
// object along the X axis (the bbox widens, height + centre + area unchanged); a
// vertical shear slants along Y. Shear preserves area (determinant = 1).

import { describe, it, expect } from "vitest";
import { makeDocument, makeRect, Ops, Query } from "../index";

const bounds = (doc: ReturnType<typeof makeDocument>, id: string) => Query.worldBounds(doc, id)!;

describe("ops.transform.shearItems", () => {
  it("horizontal shear (radX) widens the bbox, keeps height + centre", () => {
    const doc = makeDocument();
    const r = makeRect(80, 90, 40, 20, 0, 0); // centre (100,100)
    Ops.Items.addItem(doc, r);
    Ops.Transform.shearItems(doc, [r.id], Math.PI / 4, 0, { x: 100, y: 100 });
    const b = bounds(doc, r.id);
    expect(Math.round(b.width)).toBe(60); // 40 + tan(45°)·20
    expect(Math.round(b.height)).toBe(20); // unchanged
    expect(Math.round(b.x + b.width / 2)).toBe(100); // centre fixed
    expect(Math.round(b.y + b.height / 2)).toBe(100);
  });

  it("vertical shear (radY) heightens the bbox, keeps width", () => {
    const doc = makeDocument();
    const r = makeRect(80, 90, 40, 20, 0, 0);
    Ops.Items.addItem(doc, r);
    Ops.Transform.shearItems(doc, [r.id], 0, Math.PI / 4, { x: 100, y: 100 });
    const b = bounds(doc, r.id);
    expect(Math.round(b.width)).toBe(40); // unchanged
    expect(Math.round(b.height)).toBe(60); // 20 + tan(45°)·40
  });

  it("preserves area — the transform determinant stays 1", () => {
    const doc = makeDocument();
    const r = makeRect(80, 90, 40, 20, 0, 0);
    Ops.Items.addItem(doc, r);
    Ops.Transform.shearItems(doc, [r.id], 0.6, 0, { x: 100, y: 100 });
    const m = Query.getItem(doc, r.id)!.transform;
    expect(m.a * m.d - m.b * m.c).toBeCloseTo(1);
  });

  it("a zero shear is a no-op", () => {
    const doc = makeDocument();
    const r = makeRect(80, 90, 40, 20, 0, 0);
    Ops.Items.addItem(doc, r);
    const before = bounds(doc, r.id);
    Ops.Transform.shearItems(doc, [r.id], 0, 0, { x: 100, y: 100 });
    const after = bounds(doc, r.id);
    expect([after.x, after.y, after.width, after.height]).toEqual([before.x, before.y, before.width, before.height]);
  });
});
