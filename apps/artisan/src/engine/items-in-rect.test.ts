// ─────────────────────────────────────────────────────────────
// items-in-rect.test — Query.itemsInRect (Select ▸ All on Active Artboard core)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator "Select ▸ All on Active Artboard" — selects every
// top-level object whose bounds fall within (touch) the artboard. itemsInRect is
// the geometric core: objects whose world bounds intersect a rect, excluding
// hidden/locked items.

import { describe, it, expect } from "vitest";
import { makeDocument, makeRect, makeGroup, Ops, Query } from "./index";

const RECT = { x: 0, y: 0, width: 200, height: 200 };
const build = () => {
  const doc = makeDocument();
  const inside = makeRect(10, 10, 50, 50); // fully inside
  const straddle = makeRect(180, 180, 40, 40); // x/y 180..220 — overlaps the 0..200 edge
  const outside = makeRect(300, 300, 40, 40); // fully outside
  const hidden = makeRect(20, 20, 30, 30);
  hidden.visible = false;
  const locked = makeRect(30, 30, 30, 30);
  locked.locked = true;
  Ops.Items.addItems(doc, [inside, straddle, outside, hidden, locked]);
  return { doc, inside, straddle, outside, hidden, locked };
};

describe("Query.itemsInRect", () => {
  it("returns objects whose bounds intersect the rect (fully inside + straddling the edge)", () => {
    const { doc, inside, straddle } = build();
    expect(new Set(Query.itemsInRect(doc, RECT))).toEqual(new Set([inside.id, straddle.id]));
  });

  it("excludes objects that lie entirely outside", () => {
    const { doc, outside } = build();
    expect(Query.itemsInRect(doc, RECT)).not.toContain(outside.id);
  });

  it("skips hidden and locked objects", () => {
    const { doc, hidden, locked } = build();
    const ids = Query.itemsInRect(doc, RECT);
    expect(ids).not.toContain(hidden.id);
    expect(ids).not.toContain(locked.id);
  });

  it("returns nothing for a rect that overlaps no object", () => {
    const { doc } = build();
    expect(Query.itemsInRect(doc, { x: 1000, y: 1000, width: 10, height: 10 })).toEqual([]);
  });

  it("returns a group as a whole unit (not its children)", () => {
    const doc = makeDocument();
    const a = makeRect(10, 10, 40, 40);
    const b = makeRect(60, 10, 40, 40);
    const g = makeGroup([a, b]);
    Ops.Items.addItem(doc, g);
    expect(Query.itemsInRect(doc, RECT)).toEqual([g.id]); // the group id, not a.id/b.id
  });
});
