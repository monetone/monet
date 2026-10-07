// ─────────────────────────────────────────────────────────────
// ops/world-bake-container.test — world-baked results re-parented correctly
// ─────────────────────────────────────────────────────────────
// Join and Make Compound Path both concatenate their inputs in WORLD space and
// then splice the result back into the first input's container. When that
// container is a group carrying a transform, the ancestor transform is applied a
// SECOND time at render, so the artwork jumps by the group's offset the instant
// you run the command. These pin that the result stays exactly where it was.

import { describe, it, expect } from "vitest";
import { makeDocument, makePath, makeGroup, makeRect, makeAnchor as anchor, Ops, Query, solid, rgba } from "../index";

const RED = rgba(220, 0, 0);

describe("world-baked ops keep their result in place inside a transformed group", () => {
  it("Join keeps the joined path where the two open paths were", () => {
    const doc = makeDocument();
    const a = makePath({ closed: false, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 10, y: 0 })] }, { fill: solid(RED) });
    const b = makePath({ closed: false, anchors: [anchor({ x: 12, y: 0 }), anchor({ x: 20, y: 0 })] }, { fill: solid(RED) });
    const g = makeGroup([a, b], { name: "G" });
    doc.layers[0].items.push(g);
    Ops.Transform.translateItems(doc, [g.id], 100, 50); // the user drags the group

    const before = Query.selectionBounds(doc, [a.id, b.id])!;
    expect(before).toMatchObject({ x: 100, y: 50 });

    const joined = Ops.PathEdit.joinPaths(doc, [a.id, b.id])!;
    expect(joined).toBeTruthy();
    const after = Query.worldBounds(doc, joined)!;
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    expect(after.width).toBeCloseTo(before.width, 6);
  });

  it("Make Compound Path keeps the compound where the shapes were", () => {
    const doc = makeDocument();
    const r1 = makeRect(0, 0, 10, 10, 0, 0, { fill: solid(RED) });
    const r2 = makeRect(20, 0, 10, 10, 0, 0, { fill: solid(RED) });
    const g = makeGroup([r1, r2], { name: "G" });
    doc.layers[0].items.push(g);
    Ops.Transform.translateItems(doc, [g.id], 100, 50);

    const before = Query.selectionBounds(doc, [r1.id, r2.id])!;
    expect(before).toMatchObject({ x: 100, y: 50, width: 30, height: 10 });

    const cid = Ops.PathEdit.makeCompoundPath(doc, [r1.id, r2.id])!;
    expect(cid).toBeTruthy();
    const after = Query.worldBounds(doc, cid)!;
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    expect(after.width).toBeCloseTo(before.width, 6);
    expect(after.height).toBeCloseTo(before.height, 6);
  });

  it("still works at the top level, where there is no ancestor transform", () => {
    const doc = makeDocument();
    const r1 = makeRect(0, 0, 10, 10, 0, 0, { fill: solid(RED) });
    const r2 = makeRect(20, 0, 10, 10, 0, 0, { fill: solid(RED) });
    Ops.Items.addItem(doc, r1);
    Ops.Items.addItem(doc, r2);

    const cid = Ops.PathEdit.makeCompoundPath(doc, [r1.id, r2.id])!;
    expect(Query.worldBounds(doc, cid)).toMatchObject({ x: 0, y: 0, width: 30, height: 10 });
  });
});
