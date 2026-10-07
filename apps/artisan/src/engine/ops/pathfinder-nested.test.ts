// ─────────────────────────────────────────────────────────────
// ops/pathfinder-nested.test — world-baked results inside a moved group
// ─────────────────────────────────────────────────────────────
// Same class as the Join / Make Compound Path defect: these ops bake their
// geometry into WORLD space and then splice the result back into the item's own
// container. Inside a group carrying a transform the ancestors are applied a
// second time, so the artwork jumps by the group's offset the moment you erase
// or divide.

import { describe, it, expect } from "vitest";
import { makeDocument, makeRect, makeGroup, Ops, Query, solid, rgba } from "../index";

const RED = rgba(220, 0, 0);

/** A rect inside a group that the user has dragged by (100, 50). */
const movedGroup = () => {
  const doc = makeDocument();
  const target = makeRect(0, 0, 100, 100, 0, 0, { fill: solid(RED) });
  const g = makeGroup([target], { name: "G" });
  doc.layers[0].items.push(g);
  Ops.Transform.translateItems(doc, [g.id], 100, 50);
  return { doc, target, g };
};

describe("pathfinder ops inside a transformed group", () => {
  it("Eraser descends through groups but leaves hidden and locked children untouched", () => {
    const doc = makeDocument();
    const visible = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(RED) });
    const hidden = makeRect(60, 0, 40, 40, 0, 0, { fill: solid(RED) });
    hidden.visible = false;
    const locked = makeRect(120, 0, 40, 40, 0, 0, { fill: solid(RED) });
    locked.locked = true;
    const group = makeGroup([visible, hidden, locked]);
    doc.layers[0].items.push(group);
    const eraser = [[[
      [-10, -10], [170, -10], [170, 50], [-10, 50], [-10, -10],
    ]]] as Parameters<typeof Ops.Pathfinder.subtractRegionFromItems>[2];

    Ops.Pathfinder.subtractRegionFromItems(doc, [group.id], eraser);

    expect(Query.getItem(doc, visible.id)).toBeNull();
    expect(Query.getItem(doc, hidden.id)).toBe(hidden);
    expect(Query.getItem(doc, locked.id)).toBe(locked);
  });

  it.each(["unite", "divide"] as const)("keeps %s inside its group at the selected z-position", (op) => {
    const doc = makeDocument();
    const a = makeRect(0, 0, 100, 100, 0, 0, { fill: solid(RED) });
    const b = makeRect(50, 0, 100, 100, 0, 0, { fill: solid(RED) });
    const above = makeRect(200, 0, 20, 20);
    const g = makeGroup([a, b, above], { name: "G" });
    doc.layers[0].items.push(g);
    doc.layers.push({ ...doc.layers[0], id: "other", name: "Other", items: [] });

    const id = Ops.Pathfinder.pathfinder(doc, [a.id, b.id], op)!;

    expect(g.children.map((item) => item.id)).toEqual([id, above.id]);
    expect(doc.layers[1].items).toHaveLength(0);
  });

  it("keeps Shape Builder output inside its group", () => {
    const doc = makeDocument();
    const a = makeRect(0, 0, 100, 100, 0, 0, { fill: solid(RED) });
    const b = makeRect(50, 0, 100, 100, 0, 0, { fill: solid(RED) });
    const above = makeRect(200, 0, 20, 20);
    const g = makeGroup([a, b, above], { name: "G" });
    doc.layers[0].items.push(g);

    const ids = Ops.Pathfinder.shapeBuilder(doc, [a.id, b.id], [{ x: 75, y: 50 }]);

    expect(g.children.slice(0, -1).map((item) => item.id)).toEqual(ids);
    expect(g.children.at(-1)?.id).toBe(above.id);
  });

  it("prunes a group after its last child is removed", () => {
    const { doc, target, g } = movedGroup();
    Ops.Items.removeItems(doc, [target.id]);
    expect(Query.getItem(doc, g.id)).toBeNull();
  });

  it("Eraser keeps the remaining artwork where it was", () => {
    const { doc, target } = movedGroup();
    const before = Query.worldBounds(doc, target.id)!;
    expect(before).toMatchObject({ x: 100, y: 50 });

    // Erase a bite out of the right-hand side, in world coordinates. The op
    // replaces the item in place (same id), so read it back by id.
    const bite = [[[
      [160, 40],
      [260, 40],
      [260, 160],
      [160, 160],
      [160, 40],
    ]]] as unknown as Parameters<typeof Ops.Pathfinder.subtractRegionFromItems>[2];
    Ops.Pathfinder.subtractRegionFromItems(doc, [target.id], bite);

    const remaining = doc.layers[0].items.flatMap((it) => (it.type === "group" ? it.children : [it]));
    expect(remaining).toHaveLength(1);
    const after = Query.worldBounds(doc, remaining[0].id)!;
    expect(after.x).toBeCloseTo(100, 6); // still anchored at the group's position
    expect(after.y).toBeCloseTo(50, 6);
    expect(after.width).toBeLessThan(100); // a bite really was taken out
  });

  it("Divide Objects Below keeps its pieces where they were", () => {
    const doc = makeDocument();
    const below = makeRect(0, 0, 100, 100, 0, 0, { fill: solid(RED) });
    const knife = makeRect(40, -20, 20, 140, 0, 0, { fill: solid(RED) });
    const g = makeGroup([below, knife], { name: "G" });
    doc.layers[0].items.push(g);
    Ops.Transform.translateItems(doc, [g.id], 100, 50);

    const before = Query.worldBounds(doc, below.id)!;
    expect(before).toMatchObject({ x: 100, y: 50 });

    const pieces = Ops.Pathfinder.divideObjectsBelow(doc, knife.id);
    expect(pieces.length).toBeGreaterThan(0);
    for (const id of pieces) {
      const b = Query.worldBounds(doc, id)!;
      expect(b.x).toBeGreaterThanOrEqual(99); // inside the original footprint
      expect(b.x).toBeLessThanOrEqual(201);
    }
  });
});
