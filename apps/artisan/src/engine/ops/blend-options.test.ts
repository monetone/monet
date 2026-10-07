// ─────────────────────────────────────────────────────────────
// ops/blend-options.test — Object ▸ Blend ▸ Blend Options (re-spacing)
// ─────────────────────────────────────────────────────────────
// Reference: Illustrator Object ▸ Blend ▸ Blend Options sets a blend's spacing —
// "Specified Steps" inserts a fixed number of intermediate objects, "Smooth Color"
// auto-picks enough steps for an imperceptible colour transition. reblend re-spaces
// an existing blend in place, preserving its key objects / blendKeyIds / id / z-order.

import { describe, it, expect } from "vitest";
import { makeDocument, makePath, makeAnchor as anchor, makeGroup, noPaint, Ops, Query, solid, rgba } from "../index";
import type { GroupItem } from "../index";

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
const childCount = (doc: ReturnType<typeof makeDocument>, id: string) => groupOf(doc, id).children.length;

// A blend of two squares with the default 8 steps ⇒ 10 ordered children.
const blended = (steps = 8, fa = RED, fb = BLUE) => {
  const doc = makeDocument();
  const a = makePath(squareAt(0), { fill: solid(fa) });
  const b = makePath(squareAt(100), { fill: solid(fb) });
  Ops.Items.addItem(doc, a);
  Ops.Items.addItem(doc, b);
  const gid = Ops.Blend.blend(doc, [a.id, b.id], { steps })!;
  return { doc, gid };
};

describe("ops.blend.reblend — Specified Steps", () => {
  it("re-spaces an existing blend to the new step count (N + (N-1)*S children)", () => {
    const { doc, gid } = blended(8);
    expect(childCount(doc, gid)).toBe(10); // 2 keys + 8 steps
    expect(Ops.Blend.reblend(doc, [gid], { mode: "steps", steps: 16 })).toEqual([gid]);
    expect(childCount(doc, gid)).toBe(18); // 2 + 16
    Ops.Blend.reblend(doc, [gid], { mode: "steps", steps: 3 });
    expect(childCount(doc, gid)).toBe(5); // 2 + 3
  });

  it("preserves the key objects, blendKeyIds, group id and z-position", () => {
    const { doc, gid } = blended(8);
    const keysBefore = [...groupOf(doc, gid).blendKeyIds!].sort();
    const layer = doc.layers[0];
    const idxBefore = layer.items.findIndex((i) => i.id === gid);
    Ops.Blend.reblend(doc, [gid], { mode: "steps", steps: 4 });
    // same group id at the same z-position
    expect(layer.items.findIndex((i) => i.id === gid)).toBe(idxBefore);
    // blendKeyIds unchanged and still present among the children
    expect([...groupOf(doc, gid).blendKeyIds!].sort()).toEqual(keysBefore);
    const childIds = new Set(groupOf(doc, gid).children.map((c) => c.id));
    expect(keysBefore.every((k) => childIds.has(k))).toBe(true);
    // Release after re-spacing still restores exactly the key objects.
    expect(Ops.Blend.releaseBlend(doc, [gid]).slice().sort()).toEqual(keysBefore);
  });

  it("clamps a degenerate step count to at least 1", () => {
    const { doc, gid } = blended(8);
    Ops.Blend.reblend(doc, [gid], { mode: "steps", steps: 0 });
    expect(childCount(doc, gid)).toBe(3); // 2 keys + 1 step
  });
});

describe("ops.blend.reblend — Smooth Color", () => {
  it("picks the step count from the largest per-channel colour difference of the key fills", () => {
    // RED (220,0,0) → BLUE (0,0,220): max channel diff = 220 ⇒ 220 steps ⇒ 222 children.
    const { doc, gid } = blended(8, RED, BLUE);
    Ops.Blend.reblend(doc, [gid], { mode: "smooth" });
    expect(childCount(doc, gid)).toBe(222);
  });

  it("falls back to the default density when a key has no solid fill to measure", () => {
    // One end paints with no fill → there is no solid-colour distance ⇒ default 8 steps.
    const doc = makeDocument();
    const a = makePath(squareAt(0), { fill: solid(RED) });
    const b = makePath(squareAt(100), { fill: noPaint() });
    Ops.Items.addItem(doc, a);
    Ops.Items.addItem(doc, b);
    const gid = Ops.Blend.blend(doc, [a.id, b.id], { steps: 2 })!;
    Ops.Blend.reblend(doc, [gid], { mode: "smooth" });
    expect(childCount(doc, gid)).toBe(10); // 2 keys + 8 fallback steps
  });

  it("computes the step count per consecutive pair independently", () => {
    // Three keys: AB colour distance 10, BC colour distance 30 ⇒ 3 + 10 + 30 = 43 children.
    const doc = makeDocument();
    const a = makePath(squareAt(0), { fill: solid(rgba(0, 0, 0)) });
    const b = makePath(squareAt(60), { fill: solid(rgba(0, 0, 10)) });
    const c = makePath(squareAt(120), { fill: solid(rgba(0, 0, 40)) });
    Ops.Items.addItem(doc, a);
    Ops.Items.addItem(doc, b);
    Ops.Items.addItem(doc, c);
    const gid = Ops.Blend.blend(doc, [a.id, b.id, c.id], { steps: 2 })!;
    Ops.Blend.reblend(doc, [gid], { mode: "smooth" });
    expect(childCount(doc, gid)).toBe(43);
  });
});

describe("ops.blend.reblend — guards", () => {
  it("is a no-op for a selection with no blend group", () => {
    const doc = makeDocument();
    const a = makePath(squareAt(0), { fill: solid(RED) });
    Ops.Items.addItem(doc, a);
    const plain = makeGroup([makePath(squareAt(50), { fill: solid(BLUE) })], { name: "Plain" });
    Ops.Items.addItem(doc, plain);
    const plainChildren = childCount(doc, plain.id);
    expect(Ops.Blend.reblend(doc, [a.id, plain.id], { mode: "steps", steps: 5 })).toEqual([]);
    expect(childCount(doc, plain.id)).toBe(plainChildren); // plain group untouched
  });
});
