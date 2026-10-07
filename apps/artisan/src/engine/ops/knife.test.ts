// ─────────────────────────────────────────────────────────────
// ops/knife.test — Knife cut (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Knife — dragging across a filled object splits it
// into TWO separate filled paths that SHARE the cut edge (no gap). The combined
// area equals the original (nothing is removed), unlike a hairline subtraction.

import { describe, it, expect } from "vitest";
import { makeAnchor as anchor, makeDocument, makeGroup, makePath, makeRect, Ops, Query, solid, rgba } from "../index";
import type { Item } from "../index";

const RED = rgba(220, 0, 0);

const ringArea = (anchors: { point: { x: number; y: number } }[]): number => {
  let a = 0;
  for (let i = 0, n = anchors.length; i < n; i++) {
    const p = anchors[i].point;
    const q = anchors[(i + 1) % n].point;
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a / 2);
};
const itemArea = (it: Item): number => {
  if (it.type === "path") return ringArea(it.geometry.anchors);
  if (it.type === "compound") return it.subpaths.reduce((s, sp) => s + ringArea(sp.anchors), 0);
  return 0;
};

describe("ops.pathfinder.knifeCut", () => {
  it("cuts leaves inside a selected group and keeps the pieces grouped", () => {
    const doc = makeDocument();
    const rect = makeRect(0, 0, 100, 100);
    const group = makeGroup([rect]);
    Ops.Items.addItem(doc, group);
    Ops.Transform.translateItems(doc, [group.id], 100, 50);

    const ids = Ops.Pathfinder.knifeCut(doc, [group.id], { x: 90, y: 100 }, { x: 210, y: 100 });

    expect(ids).toHaveLength(2);
    expect(group.children.map((item) => item.id)).toEqual(ids);
    for (const id of ids) {
      const bounds = Query.worldBounds(doc, id)!;
      expect(bounds.x).toBeGreaterThanOrEqual(100);
      expect(bounds.y).toBeGreaterThanOrEqual(50);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(200);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(150);
    }
  });

  it("emits each disconnected region of a concave cut as its own object", () => {
    const doc = makeDocument();
    const u = makePath({
      closed: true,
      anchors: [
        [0, 0], [100, 0], [100, 100], [70, 100],
        [70, 30], [30, 30], [30, 100], [0, 100],
      ].map(([x, y]) => anchor({ x, y })),
    });
    Ops.Items.addItem(doc, u);

    const ids = Ops.Pathfinder.knifeCut(doc, [u.id], { x: -10, y: 50 }, { x: 110, y: 50 });

    expect(ids).toHaveLength(3);
    expect(doc.layers[0].items).toHaveLength(3);
    expect(doc.layers[0].items.every((item) => item.type === "path")).toBe(true);
    expect(doc.layers[0].items.reduce((sum, item) => sum + itemArea(item), 0)).toBeCloseTo(7200, 0);
  });

  it("splits a square into two pieces that share the cut edge (no gap)", () => {
    const doc = makeDocument();
    const sq = makeRect(0, 0, 100, 100, 0, 0, { fill: solid(RED) }); // [0,100]²
    Ops.Items.addItem(doc, sq);
    const ids = Ops.Pathfinder.knifeCut(doc, [sq.id], { x: 50, y: -10 }, { x: 50, y: 110 }); // vertical through the middle
    expect(ids.length).toBe(2);
    const items = doc.layers[0].items;
    expect(items.length).toBe(2); // the square is replaced by two pieces
    const total = items.reduce((s, it) => s + itemArea(it), 0);
    expect(total).toBeCloseTo(10000, 0); // full area preserved → no gap
    for (const it of items) expect(itemArea(it)).toBeCloseTo(5000, 0); // each half
  });

  it("cuts along a diagonal into two triangles", () => {
    const doc = makeDocument();
    const sq = makeRect(0, 0, 100, 100);
    Ops.Items.addItem(doc, sq);
    const ids = Ops.Pathfinder.knifeCut(doc, [sq.id], { x: 0, y: 0 }, { x: 100, y: 100 });
    expect(ids.length).toBe(2);
    const items = doc.layers[0].items;
    const total = items.reduce((s, it) => s + itemArea(it), 0);
    expect(total).toBeCloseTo(10000, 0);
    for (const it of items) expect(itemArea(it)).toBeCloseTo(5000, 0);
  });

  it("keeps the original fill on both pieces", () => {
    const doc = makeDocument();
    const sq = makeRect(0, 0, 100, 100, 0, 0, { fill: solid(RED) });
    Ops.Items.addItem(doc, sq);
    Ops.Pathfinder.knifeCut(doc, [sq.id], { x: 50, y: -10 }, { x: 50, y: 110 });
    for (const it of doc.layers[0].items) expect(it.fill).toEqual(solid(RED));
  });

  it("leaves a shape the line never crosses untouched", () => {
    const doc = makeDocument();
    const sq = makeRect(0, 0, 100, 100);
    Ops.Items.addItem(doc, sq);
    const ids = Ops.Pathfinder.knifeCut(doc, [sq.id], { x: 200, y: -10 }, { x: 200, y: 110 }); // misses
    expect(ids).toEqual([]);
    expect(doc.layers[0].items.length).toBe(1);
    expect(doc.layers[0].items[0].id).toBe(sq.id);
  });
});
