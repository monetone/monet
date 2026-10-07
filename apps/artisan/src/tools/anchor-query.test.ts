import { describe, expect, it } from "vitest";
import { makeCompound, makeDocument, makeGroup, makePath, makeAnchor } from "../engine";
import { nearestAnchor } from "./anchor-query";

describe("nearestAnchor", () => {
  it("ignores hidden and locked items, ancestors, and layers", () => {
    const doc = makeDocument();
    const path = makePath({ closed: false, anchors: [makeAnchor({ x: 0, y: 0 }), makeAnchor({ x: 20, y: 0 })] });
    const group = makeGroup([path]);
    doc.layers[0].items.push(group);
    const hit = () => nearestAnchor(doc, { x: 0, y: 0 }, (point) => point);

    expect(hit()?.id).toBe(path.id);
    path.locked = true;
    expect(hit()).toBeNull();
    path.locked = false;
    group.visible = false;
    expect(hit()).toBeNull();
    group.visible = true;
    doc.layers[0].locked = true;
    expect(hit()).toBeNull();
  });

  it("flattens compound subpaths into one anchor index", () => {
    const doc = makeDocument();
    const compound = makeCompound([
      { closed: false, anchors: [makeAnchor({ x: 0, y: 0 }), makeAnchor({ x: 20, y: 0 })] },
      { closed: false, anchors: [makeAnchor({ x: 100, y: 0 }), makeAnchor({ x: 120, y: 0 })] },
    ]);
    doc.layers[0].items.push(compound);

    expect(nearestAnchor(doc, { x: 100, y: 0 }, (point) => point)).toMatchObject({ id: compound.id, index: 2 });
    expect(nearestAnchor(doc, { x: 100, y: 0 }, (point) => point, 7, { includeCompounds: false })).toBeNull();
  });
});
