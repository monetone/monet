// ─────────────────────────────────────────────────────────────
// ops/transform.test — Rotate 90° / Reflect (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Object ▸ Transform — Rotate / Reflect operate on
// the whole selection around a single pivot (the menu commands use the selection
// bounding-box centre). A 90° rotation swaps the selection bbox's width/height
// and keeps its centre; Reflect across a vertical axis mirrors left↔right, across
// a horizontal axis mirrors top↔bottom; reflection flips orientation (det < 0).

import { describe, it, expect } from "vitest";
import { makeDocument, makeRect, Ops, Query } from "../index";

const det = (t: { a: number; b: number; c: number; d: number }) => t.a * t.d - t.b * t.c;
const centerOf = (b: { x: number; y: number; width: number; height: number }) => [b.x + b.width / 2, b.y + b.height / 2];

describe("ops.transform — rotateItems (90°)", () => {
  it("swaps the selection bbox width/height and keeps its centre", () => {
    const doc = makeDocument();
    const a = makeRect(0, 0, 40, 20);
    const b = makeRect(0, 40, 20, 40);
    Ops.Items.addItems(doc, [a, b]);
    const before = Query.selectionBounds(doc, [a.id, b.id])!; // 40 × 80, centre (20,40)
    const c = { x: before.x + before.width / 2, y: before.y + before.height / 2 };
    Ops.Transform.rotateItems(doc, [a.id, b.id], Math.PI / 2, c);
    const after = Query.selectionBounds(doc, [a.id, b.id])!;
    expect(centerOf(after)).toEqual(centerOf(before)); // centre preserved
    expect([Math.round(after.width), Math.round(after.height)]).toEqual([
      Math.round(before.height),
      Math.round(before.width),
    ]); // dims swapped
  });

  it("preserves orientation (det > 0)", () => {
    const doc = makeDocument();
    const a = makeRect(0, 0, 40, 20);
    Ops.Items.addItem(doc, a);
    Ops.Transform.rotateItems(doc, [a.id], Math.PI / 2, { x: 20, y: 10 });
    expect(det(Query.getItem(doc, a.id)!.transform)).toBeCloseTo(1, 6);
  });
});

describe("ops.transform — reflectItems", () => {
  it("horizontal reflect (vertical axis) swaps left↔right, keeps Y", () => {
    const doc = makeDocument();
    const a = makeRect(0, 0, 20, 20); // left
    const b = makeRect(100, 0, 20, 20); // right
    Ops.Items.addItems(doc, [a, b]);
    const ref = Query.selectionBounds(doc, [a.id, b.id])!;
    const c = { x: ref.x + ref.width / 2, y: ref.y + ref.height / 2 }; // (60,10)
    Ops.Transform.reflectItems(doc, [a.id, b.id], Math.PI / 2, c); // reflectHorizontal
    const wa = Query.worldBounds(doc, a.id)!;
    const wb = Query.worldBounds(doc, b.id)!;
    expect(Math.round(wa.x)).toBe(100); // A → where B was
    expect(Math.round(wb.x)).toBe(0); // B → where A was
    expect(wa.y).toBeCloseTo(0, 6); // Y unchanged (toBeCloseTo avoids -0 ≠ 0)
    expect(wb.y).toBeCloseTo(0, 6);
  });

  it("vertical reflect (horizontal axis) swaps top↔bottom, keeps X", () => {
    const doc = makeDocument();
    const a = makeRect(0, 0, 20, 20); // top
    const b = makeRect(0, 100, 20, 20); // bottom
    Ops.Items.addItems(doc, [a, b]);
    const ref = Query.selectionBounds(doc, [a.id, b.id])!;
    const c = { x: ref.x + ref.width / 2, y: ref.y + ref.height / 2 };
    Ops.Transform.reflectItems(doc, [a.id, b.id], 0, c); // reflectVertical
    const wa = Query.worldBounds(doc, a.id)!;
    const wb = Query.worldBounds(doc, b.id)!;
    expect(Math.round(wa.y)).toBe(100);
    expect(Math.round(wb.y)).toBe(0);
    expect(wa.x).toBeCloseTo(0, 6); // X unchanged
    expect(wb.x).toBeCloseTo(0, 6);
  });

  it("flips orientation (det < 0)", () => {
    const doc = makeDocument();
    const a = makeRect(0, 0, 20, 20);
    Ops.Items.addItem(doc, a);
    Ops.Transform.reflectItems(doc, [a.id], 0, { x: 10, y: 10 });
    expect(det(Query.getItem(doc, a.id)!.transform)).toBeLessThan(0);
  });
});
