// ─────────────────────────────────────────────────────────────
// ops/divide-below.test — Object ▸ Path ▸ Divide Objects Below (parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator "Divide Objects Below" — the selected object is a
// cookie-cutter that slices every object beneath it into the part inside and the
// part outside the cutter (each keeping its own paint); the cutter is then
// deleted. Axis-aligned rectangles give an exact, hand-computable result.

import { describe, it, expect } from "vitest";
import { makeDocument, makeRect, makePath, makeAnchor as anchor, Ops, Query, solid, rgba } from "../index";
import type { Rect } from "../index";

const RED = rgba(220, 0, 0);
const build = (rects: [number, number, number, number][]) => {
  const doc = makeDocument();
  const ids = rects.map(([x, y, w, h]) => {
    const r = makeRect(x, y, w, h, 0, 0, { fill: solid(RED) });
    Ops.Items.addItem(doc, r);
    return r.id;
  });
  return { doc, ids };
};
const wb = (doc: ReturnType<typeof makeDocument>, id: string) => Query.worldBounds(doc, id)!;
const top = (doc: ReturnType<typeof makeDocument>) => doc.layers[0].items;
const expectRect = (b: Rect, x: number, y: number, w: number, h: number) => {
  expect(b.x).toBeCloseTo(x, 3);
  expect(b.y).toBeCloseTo(y, 3);
  expect(b.width).toBeCloseTo(w, 3);
  expect(b.height).toBeCloseTo(h, 3);
};
const fillOf = (doc: ReturnType<typeof makeDocument>, id: string) => {
  const f = Query.getItem(doc, id)!.fill;
  return f.type === "solid" ? f.color : null;
};

describe("ops.pathfinder.divideObjectsBelow", () => {
  it("splits the object below into the inside and outside halves, then removes the cutter", () => {
    // target [0..100]² · cutter covers the right half (x 50..150, spanning y).
    const { doc, ids } = build([
      [0, 0, 100, 100],
      [50, -10, 100, 120],
    ]);
    const [target, cutter] = ids;
    const pieces = Ops.Pathfinder.divideObjectsBelow(doc, cutter);

    expect(pieces).toHaveLength(2);
    expect(top(doc)).toHaveLength(2); // 2 pieces; cutter + original target gone
    expect(Query.getItem(doc, cutter)).toBeFalsy();
    expect(Query.getItem(doc, target)).toBeFalsy();

    const bs = pieces.map((id) => wb(doc, id)).sort((a, b) => a.x - b.x);
    expectRect(bs[0], 0, 0, 50, 100); // outside (left half)
    expectRect(bs[1], 50, 0, 50, 100); // inside (right half)
    for (const id of pieces) expect(fillOf(doc, id)).toEqual({ r: 220, g: 0, b: 0, a: 1 }); // paint preserved
  });

  it("cuts every overlapping object below and leaves non-overlapping ones untouched", () => {
    // A[0..40] B[60..100] C[200..240]; cutter x 20..80 overlaps A & B only.
    const { doc, ids } = build([
      [0, 0, 40, 40],
      [60, 0, 40, 40],
      [200, 0, 40, 40],
      [20, -10, 60, 60],
    ]);
    const [, , c, cutter] = ids;
    const pieces = Ops.Pathfinder.divideObjectsBelow(doc, cutter);

    expect(pieces).toHaveLength(4); // A→2, B→2
    expect(top(doc)).toHaveLength(5); // A(2) + B(2) + C(1); cutter gone
    expect(Query.getItem(doc, cutter)).toBeFalsy();
    expectRect(wb(doc, c), 200, 0, 40, 40); // C is untouched
  });

  it("is a no-op (cutter kept) when nothing drawable sits below it", () => {
    const { doc, ids } = build([[0, 0, 40, 40]]); // the cutter is the only object
    const [only] = ids;
    expect(Ops.Pathfinder.divideObjectsBelow(doc, only)).toEqual([]);
    expect(top(doc)).toHaveLength(1);
    expect(Query.getItem(doc, only)).toBeTruthy(); // not consumed
  });

  it("removes the cutter but leaves a below object untouched when they don't overlap", () => {
    const { doc, ids } = build([
      [0, 0, 40, 40],
      [500, 500, 10, 10], // cutter, far away
    ]);
    const [target, cutter] = ids;
    expect(Ops.Pathfinder.divideObjectsBelow(doc, cutter)).toEqual([]); // no pieces produced
    expect(top(doc)).toHaveLength(1); // cutter consumed (stencil), target survives
    expectRect(wb(doc, target), 0, 0, 40, 40);
    expect(Query.getItem(doc, cutter)).toBeFalsy();
  });

  it("pieces keep the target's FULL appearance (opacity, blend mode, effects), not just paint", () => {
    const doc = makeDocument();
    const target = makeRect(0, 0, 100, 100, 0, 0, { fill: solid(RED) });
    target.opacity = 0.42;
    target.blendMode = "multiply";
    target.effects = [{ type: "drop-shadow", dx: 6, dy: 6, blur: 6, color: rgba(0, 0, 0, 0.5) }];
    const cutter = makeRect(50, -10, 100, 120);
    Ops.Items.addItems(doc, [target, cutter]);
    const pieces = Ops.Pathfinder.divideObjectsBelow(doc, cutter.id);
    expect(pieces).toHaveLength(2);
    for (const id of pieces) {
      const p = Query.getItem(doc, id)!;
      expect(p.opacity).toBe(0.42);
      expect(p.blendMode).toBe("multiply");
      expect(p.effects?.[0]?.type).toBe("drop-shadow");
    }
  });

  it("leaves hidden and locked objects below untouched (and doesn't consume the cutter for them)", () => {
    const doc = makeDocument();
    const hidden = makeRect(0, 0, 100, 100, 0, 0, { fill: solid(RED) });
    hidden.visible = false;
    const locked = makeRect(0, 0, 100, 100, 0, 0, { fill: solid(RED) });
    locked.locked = true;
    const cutter = makeRect(50, -10, 100, 120);
    Ops.Items.addItems(doc, [hidden, locked, cutter]);
    expect(Ops.Pathfinder.divideObjectsBelow(doc, cutter.id)).toEqual([]); // nothing drawable below
    expect(top(doc)).toHaveLength(3); // hidden + locked untouched, cutter kept
    expect(Query.getItem(doc, hidden.id)).toBeTruthy();
    expect(Query.getItem(doc, locked.id)).toBeTruthy();
    expect(Query.getItem(doc, cutter.id)).toBeTruthy();
  });

  it("makes an even-odd holed compound when the cutter sits fully inside the target", () => {
    const { doc, ids } = build([
      [0, 0, 100, 100],
      [40, 40, 20, 20], // cutter fully inside
    ]);
    const [, cutter] = ids;
    const pieces = Ops.Pathfinder.divideObjectsBelow(doc, cutter);
    expect(pieces).toHaveLength(2);
    const byW = pieces.map((id) => ({ id, b: wb(doc, id) })).sort((a, b) => a.b.width - b.b.width);
    expectRect(byW[0].b, 40, 40, 20, 20); // the inside square
    expectRect(byW[1].b, 0, 0, 100, 100); // the outside ring (holed compound, full bounds)
    const outside = Query.getItem(doc, byW[1].id)!;
    expect(outside.type).toBe("compound"); // outer + hole ⇒ compound
  });

  it("produces a single piece when the target sits fully inside the cutter", () => {
    const { doc, ids } = build([
      [40, 40, 20, 20], // small target
      [0, 0, 100, 100], // cutter covers it entirely
    ]);
    const [, cutter] = ids;
    const pieces = Ops.Pathfinder.divideObjectsBelow(doc, cutter);
    expect(pieces).toHaveLength(1);
    expectRect(wb(doc, pieces[0]), 40, 40, 20, 20);
    expect(top(doc)).toHaveLength(1); // 1 piece; cutter consumed
  });

  it("is a no-op for a cutter with no fillable area (open path)", () => {
    const doc = makeDocument();
    const target = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(RED) });
    const cutter = makePath({ closed: false, anchors: [anchor({ x: 50, y: -10 }), anchor({ x: 50, y: 120 })] });
    Ops.Items.addItems(doc, [target, cutter]);
    expect(Ops.Pathfinder.divideObjectsBelow(doc, cutter.id)).toEqual([]);
    expect(top(doc)).toHaveLength(2); // both intact (cutter not consumed — no area)
    expectRect(wb(doc, target.id), 0, 0, 40, 40);
  });
});
