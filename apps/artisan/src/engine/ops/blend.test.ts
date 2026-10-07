// ─────────────────────────────────────────────────────────────
// ops/blend.test — Object ▸ Blend ▸ Make (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Object ▸ Blend ▸ Make (Specified Steps) — inserts
// N intermediate shapes between selected objects, interpolating both shape and
// appearance (fill/stroke/opacity), and groups the result as one "Blend".

import { describe, it, expect } from "vitest";
import {
  makeDocument,
  makePath,
  makeAnchor as anchor,
  Ops,
  Query,
  solid,
  rgba,
  defaultStroke,
} from "../index";
import type { GroupItem, PathItem } from "../index";

const RED = rgba(220, 0, 0);
const BLUE = rgba(0, 0, 220);
const squareAt = (x: number, s = 20) => ({
  closed: true,
  anchors: [anchor({ x, y: 0 }), anchor({ x: x + s, y: 0 }), anchor({ x: x + s, y: s }), anchor({ x, y: s })],
});
const groupOf = (doc: ReturnType<typeof makeDocument>, id: string): GroupItem => {
  const it = Query.getItem(doc, id)!;
  if (it.type !== "group") throw new Error("not a group");
  return it;
};
const boundsOf = (doc: ReturnType<typeof makeDocument>, id: string) => Query.worldBounds(doc, id)!;

describe("ops.blend.blend — make", () => {
  it("wraps the originals + one interpolated step in a Blend group", () => {
    const doc = makeDocument();
    const a = makePath(squareAt(0), { fill: solid(RED) });
    const b = makePath(squareAt(100), { fill: solid(BLUE) });
    Ops.Items.addItem(doc, a);
    Ops.Items.addItem(doc, b);

    const gid = Ops.Blend.blend(doc, [a.id, b.id], { steps: 1 });
    expect(gid).toBeTruthy();
    const g = groupOf(doc, gid!);
    expect(g.name).toBe("Blend");
    expect(g.children).toHaveLength(3); // end + 1 step + end
    // the two source objects are consumed into the blend group
    expect(doc.layers[0].items).toHaveLength(1);
    expect(doc.layers[0].items[0].id).toBe(gid);
  });

  it("interpolates geometry and fill at the midpoint", () => {
    const doc = makeDocument();
    const a = makePath(squareAt(0), { fill: solid(RED) });
    const b = makePath(squareAt(100), { fill: solid(BLUE) });
    Ops.Items.addItem(doc, a);
    Ops.Items.addItem(doc, b);

    const gid = Ops.Blend.blend(doc, [a.id, b.id], { steps: 1 })!;
    const mid = groupOf(doc, gid).children[1] as PathItem;
    // halfway between x=0 and x=100 → a 20×20 square at x=50
    const bb = boundsOf(doc, mid.id);
    expect([bb.x, bb.y, bb.width, bb.height]).toEqual([50, 0, 20, 20]);
    // fill is the 50/50 colour mix of red and blue
    expect(mid.fill).toEqual(solid({ r: 110, g: 0, b: 110, a: 1 }));
  });

  it("creates `steps` intermediates per pair (3 steps ⇒ 5 children)", () => {
    const doc = makeDocument();
    const a = makePath(squareAt(0), { fill: solid(RED) });
    const b = makePath(squareAt(100), { fill: solid(BLUE) });
    Ops.Items.addItem(doc, a);
    Ops.Items.addItem(doc, b);
    const gid = Ops.Blend.blend(doc, [a.id, b.id], { steps: 3 })!;
    expect(groupOf(doc, gid).children).toHaveLength(5);
  });

  it("chains a multi-object selection in stacking order (3 objects, 1 step ⇒ 5)", () => {
    const doc = makeDocument();
    const a = makePath(squareAt(0), { fill: solid(RED) });
    const b = makePath(squareAt(100), { fill: solid(BLUE) });
    const c = makePath(squareAt(200), { fill: solid(RED) });
    Ops.Items.addItem(doc, a);
    Ops.Items.addItem(doc, b);
    Ops.Items.addItem(doc, c);
    // selection order intentionally scrambled — blend must use z-order
    const gid = Ops.Blend.blend(doc, [c.id, a.id, b.id], { steps: 1 })!;
    const kids = groupOf(doc, gid).children as PathItem[];
    expect(kids).toHaveLength(5); // a, a→b, b, b→c, c
    // first child is the bottom object (a, at x=0); last is the top (c, at x=200)
    expect(boundsOf(doc, kids[0].id).x).toBe(0);
    expect(boundsOf(doc, kids[4].id).x).toBe(200);
  });

  it("interpolates stroke width and opacity", () => {
    const doc = makeDocument();
    const a = makePath(squareAt(0), { fill: solid(RED), stroke: { ...defaultStroke(solid(RED)), width: 2 }, opacity: 1 });
    const b = makePath(squareAt(100), { fill: solid(BLUE), stroke: { ...defaultStroke(solid(BLUE)), width: 10 }, opacity: 0.5 });
    Ops.Items.addItem(doc, a);
    Ops.Items.addItem(doc, b);
    const gid = Ops.Blend.blend(doc, [a.id, b.id], { steps: 1 })!;
    const mid = groupOf(doc, gid).children[1] as PathItem;
    expect(mid.stroke.width).toBeCloseTo(6, 6); // (2 + 10) / 2
    expect(mid.opacity).toBeCloseTo(0.75, 6); // (1 + 0.5) / 2
  });
});

describe("ops.blend.blend — correspondence & guards", () => {
  it("resamples to a common anchor count when shapes differ (triangle ↔ square)", () => {
    const doc = makeDocument();
    const tri = makePath({ closed: true, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 20, y: 0 }), anchor({ x: 10, y: 20 })] }, { fill: solid(RED) });
    const sq = makePath(squareAt(100), { fill: solid(BLUE) });
    Ops.Items.addItem(doc, tri);
    Ops.Items.addItem(doc, sq);
    const gid = Ops.Blend.blend(doc, [tri.id, sq.id], { steps: 1 })!;
    const mid = groupOf(doc, gid).children[1] as PathItem;
    expect(mid.type).toBe("path");
    expect(mid.geometry.anchors).toHaveLength(4); // max(3, 4) resample
    expect(mid.geometry.closed).toBe(true);
  });

  it("adds an object to an EXISTING blend instead of no-opping on it", () => {
    // Illustrator: selecting a blend + another object and running Blend ▸ Make
    // extends the blend. A blend group carries no outline of its own, so without
    // releasing it first the command would see only one blendable end and bail.
    const doc = makeDocument();
    const a = makePath(squareAt(0), { fill: solid(RED) });
    const b = makePath(squareAt(100), { fill: solid(BLUE) });
    const c = makePath(squareAt(200), { fill: solid(RED) });
    for (const it of [a, b, c]) Ops.Items.addItem(doc, it);

    const first = Ops.Blend.blend(doc, [a.id, b.id], { steps: 1 })!;
    expect(doc.layers[0].items).toHaveLength(2); // blend + c

    const second = Ops.Blend.blend(doc, [first, c.id], { steps: 1 })!;
    expect(second).toBeTruthy();
    expect(doc.layers[0].items).toHaveLength(1); // one blend spanning all three
    const grp = groupOf(doc, second);
    expect(grp.blendKeyIds).toHaveLength(3); // a, b, c are all key objects now
    expect(grp.children).toHaveLength(5); // 3 keys + 1 step between each pair
  });

  it("Release keeps a moved blend's artwork where the user put it", () => {
    // The keys inside a blend are baked in the group's LOCAL space, so releasing
    // must compose the group's own transform into each restored key — otherwise
    // every move/rotate/scale applied to the blend is silently discarded.
    const doc = makeDocument();
    const a = makePath(squareAt(0), { fill: solid(RED) });
    const b = makePath(squareAt(100), { fill: solid(BLUE) });
    Ops.Items.addItem(doc, a);
    Ops.Items.addItem(doc, b);

    const gid = Ops.Blend.blend(doc, [a.id, b.id], { steps: 1 })!;
    Ops.Transform.translateItems(doc, [gid], 0, 300);
    expect(Query.worldBounds(doc, gid)).toMatchObject({ y: 300 });

    const restored = Ops.Blend.releaseBlend(doc, [gid]);
    expect(restored).toHaveLength(2);
    for (const id of restored) expect(Query.worldBounds(doc, id)!.y).toBeCloseTo(300, 6);
  });

  it("adding to a MOVED blend keeps it where the user put it", () => {
    const doc = makeDocument();
    const a = makePath(squareAt(0), { fill: solid(RED) });
    const b = makePath(squareAt(100), { fill: solid(BLUE) });
    const c = makePath(squareAt(200), { fill: solid(RED) });
    for (const it of [a, b, c]) Ops.Items.addItem(doc, it);

    const first = Ops.Blend.blend(doc, [a.id, b.id], { steps: 1 })!;
    Ops.Transform.translateItems(doc, [first], 0, 300);
    Ops.Transform.translateItems(doc, [c.id], 0, 300); // the third object is up there too

    const second = Ops.Blend.blend(doc, [first, c.id], { steps: 1 })!;
    expect(Query.worldBounds(doc, second)!.y).toBeCloseTo(300, 6);
  });

  it("returns null and changes nothing for fewer than two path objects", () => {
    const doc = makeDocument();
    const a = makePath(squareAt(0), { fill: solid(RED) });
    Ops.Items.addItem(doc, a);
    expect(Ops.Blend.blend(doc, [a.id], { steps: 2 })).toBeNull();
    expect(doc.layers[0].items).toHaveLength(1);
    expect(doc.layers[0].items[0].id).toBe(a.id); // untouched
  });
});
