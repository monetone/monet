// ─────────────────────────────────────────────────────────────
// ops/blend-release.test — Object ▸ Blend ▸ Release (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Object ▸ Blend ▸ Release (Opt-Shift-Cmd-B) — undo
// a blend, restoring the original key objects in place and discarding the
// interpolated steps. Our Make bakes [origA, …steps, origB] into a "Blend" group
// tagged with blendKeyIds; Release splices the key children back into the
// container at the group's z-position.

import { describe, it, expect } from "vitest";
import { makeDocument, makePath, makeRect, makeGroup, makeAnchor as anchor, Ops, Query, solid, rgba } from "../index";
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

describe("ops.blend.releaseBlend", () => {
  it("Make tags the Blend group with the ids of the two baked originals (not the steps)", () => {
    const doc = makeDocument();
    const a = makePath(squareAt(0), { fill: solid(RED) });
    const b = makePath(squareAt(100), { fill: solid(BLUE) });
    Ops.Items.addItem(doc, a);
    Ops.Items.addItem(doc, b);
    const gid = Ops.Blend.blend(doc, [a.id, b.id], { steps: 3 })!;
    const g = groupOf(doc, gid);
    expect(g.children).toHaveLength(5); // end + 3 steps + end
    expect(g.blendKeyIds).toHaveLength(2); // only the two originals
    // the tagged keys are the first and last children (the baked ends)
    expect(g.blendKeyIds).toEqual([g.children[0].id, g.children[4].id]);
  });

  it("Release restores exactly the key objects, removes the steps, and returns their ids", () => {
    const doc = makeDocument();
    const a = makePath(squareAt(0), { fill: solid(RED) });
    const b = makePath(squareAt(100), { fill: solid(BLUE) });
    Ops.Items.addItem(doc, a);
    Ops.Items.addItem(doc, b);
    const gid = Ops.Blend.blend(doc, [a.id, b.id], { steps: 5 })!;
    const keyIds = groupOf(doc, gid).blendKeyIds!.slice();

    const restored = Ops.Blend.releaseBlend(doc, [gid]);
    expect(restored).toEqual(keyIds);
    const items = doc.layers[0].items;
    expect(items.map((i) => i.id)).toEqual(keyIds); // only the 2 keys, group gone
    expect(items.every((i) => i.type !== "group")).toBe(true);
  });

  it("preserves z-order: keys land where the blend group was, between surrounding art", () => {
    const doc = makeDocument();
    const bg = makeRect(0, 0, 10, 10, 0, 0, { fill: solid(RED) }); // bottom
    const a = makePath(squareAt(0), { fill: solid(RED) });
    const b = makePath(squareAt(100), { fill: solid(BLUE) });
    const fg = makeRect(0, 0, 10, 10, 0, 0, { fill: solid(BLUE) }); // top
    Ops.Items.addItems(doc, [bg, a, b, fg]);
    const gid = Ops.Blend.blend(doc, [a.id, b.id], { steps: 2 })!;
    // after make: [bg, blendGroup, fg]
    expect(doc.layers[0].items.map((i) => i.id)).toEqual([bg.id, gid, fg.id]);
    const keyIds = groupOf(doc, gid).blendKeyIds!.slice();

    Ops.Blend.releaseBlend(doc, [gid]);
    // keys spliced in at the group's index → [bg, keyA, keyB, fg]
    expect(doc.layers[0].items.map((i) => i.id)).toEqual([bg.id, ...keyIds, fg.id]);
  });

  it("ignores a plain group (no blendKeyIds) — safe no-op", () => {
    const doc = makeDocument();
    const x = makeRect(0, 0, 10, 10);
    const y = makeRect(0, 0, 10, 10);
    const g = makeGroup([x, y]);
    Ops.Items.addItem(doc, g);
    expect(Ops.Blend.releaseBlend(doc, [g.id])).toEqual([]);
    expect(doc.layers[0].items).toHaveLength(1); // untouched
    expect(doc.layers[0].items[0].id).toBe(g.id);
  });

  it("releases blends from a multi-step chain of three objects too", () => {
    const doc = makeDocument();
    const a = makePath(squareAt(0), { fill: solid(RED) });
    const b = makePath(squareAt(100), { fill: solid(BLUE) });
    const c = makePath(squareAt(200), { fill: solid(RED) });
    Ops.Items.addItems(doc, [a, b, c]);
    const gid = Ops.Blend.blend(doc, [a.id, b.id, c.id], { steps: 2 })!;
    expect(groupOf(doc, gid).blendKeyIds).toHaveLength(3); // three originals

    const restored = Ops.Blend.releaseBlend(doc, [gid]);
    expect(restored).toHaveLength(3);
    expect(doc.layers[0].items.map((i) => i.id)).toEqual(restored); // 3 keys, no group
  });

  it("deleting blend keys clears the role and Release cannot discard the surviving steps (#361)", () => {
    const doc = makeDocument();
    const a = makePath(squareAt(0), { fill: solid(RED) });
    const b = makePath(squareAt(100), { fill: solid(BLUE) });
    Ops.Items.addItems(doc, [a, b]);
    const gid = Ops.Blend.blend(doc, [a.id, b.id], { steps: 3 })!;
    const group = groupOf(doc, gid);
    const keys = [...group.blendKeyIds!];

    Ops.Items.removeItems(doc, keys);
    expect(group.blendKeyIds).toBeUndefined();
    expect(group.children).toHaveLength(3);
    expect(Ops.Blend.releaseBlend(doc, [gid])).toEqual([]);
    expect(Query.getItem(doc, gid)).toBe(group);

    // Malformed saved data with stale ids gets the same defensive no-op.
    group.blendKeyIds = keys;
    expect(Ops.Blend.releaseBlend(doc, [gid])).toEqual([]);
    expect(Query.getItem(doc, gid)).toBe(group);
  });
});
