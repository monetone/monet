// ─────────────────────────────────────────────────────────────
// ops/distribute-spacing.test — Align ▸ Distribute Spacing (fixed gap)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Align panel "Distribute Spacing" with a value —
// lay the selected objects out so the gap between each adjacent pair equals the
// value, anchoring the first (lowest) object. Distinct from auto distribute.

import { describe, it, expect } from "vitest";
import { makeDocument, makeRect, Ops, Query } from "../index";

const wb = (doc: ReturnType<typeof makeDocument>, id: string) => Query.worldBounds(doc, id)!;
// adjacent edge-to-edge gaps along x for a left→right sorted set
const gapsX = (doc: ReturnType<typeof makeDocument>, ids: string[]) => {
  const bs = ids.map((id) => wb(doc, id)).sort((a, b) => a.x - b.x);
  return bs.slice(1).map((b, i) => b.x - (bs[i].x + bs[i].width));
};

// three rects of DIFFERENT widths at irregular x (same row)
const setup = () => {
  const doc = makeDocument();
  const r1 = makeRect(0, 0, 30, 10);
  const r2 = makeRect(100, 0, 50, 10);
  const r3 = makeRect(300, 0, 20, 10);
  Ops.Items.addItems(doc, [r1, r2, r3]);
  return { doc, ids: [r1.id, r2.id, r3.id] };
};

describe("ops.align.distributeSpacing", () => {
  it("places objects with an exact horizontal gap, anchoring the first", () => {
    const { doc, ids } = setup();
    Ops.Align.distributeSpacing(doc, ids, "h", 10);
    expect(wb(doc, ids[0]).x).toBe(0); // first stays put
    expect(gapsX(doc, ids)).toEqual([10, 10]);
  });

  it("gap 0 makes adjacent objects abut", () => {
    const { doc, ids } = setup();
    Ops.Align.distributeSpacing(doc, ids, "h", 0);
    expect(gapsX(doc, ids)).toEqual([0, 0]);
  });

  it("is order-independent (sorts internally) and affects only the chosen axis", () => {
    const { doc, ids } = setup();
    const ysBefore = ids.map((id) => wb(doc, id).y);
    Ops.Align.distributeSpacing(doc, [ids[2], ids[0], ids[1]], "h", 15); // shuffled input
    expect(gapsX(doc, ids)).toEqual([15, 15]);
    expect(ids.map((id) => wb(doc, id).y)).toEqual(ysBefore); // y untouched
  });

  it("distributes vertical spacing too", () => {
    const doc = makeDocument();
    const a = makeRect(0, 0, 10, 30);
    const b = makeRect(0, 100, 10, 50);
    const c = makeRect(0, 300, 10, 20);
    Ops.Items.addItems(doc, [a, b, c]);
    Ops.Align.distributeSpacing(doc, [a.id, b.id, c.id], "v", 10);
    expect(wb(doc, a.id).y).toBe(0); // first anchored
    const bs = [a, b, c].map((r) => wb(doc, r.id)).sort((p, q) => p.y - q.y);
    const gaps = bs.slice(1).map((bb, i) => bb.y - (bs[i].y + bs[i].height));
    expect(gaps).toEqual([10, 10]);
  });

  it("accepts a negative gap (objects overlap by that amount)", () => {
    const { doc, ids } = setup();
    Ops.Align.distributeSpacing(doc, ids, "h", -5);
    expect(gapsX(doc, ids)).toEqual([-5, -5]); // each pair overlaps by 5
  });

  it("is a no-op for fewer than two items", () => {
    const { doc, ids } = setup();
    const before = wb(doc, ids[0]);
    Ops.Align.distributeSpacing(doc, [ids[0]], "h", 10);
    expect(wb(doc, ids[0])).toEqual(before);
  });
});
