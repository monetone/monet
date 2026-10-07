// ─────────────────────────────────────────────────────────────
// ops/layers.test — Object ▸ Lock/Hide ▸ Other Layers (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator "Lock ▸ Other Layers" / "Hide ▸ Other Layers" —
// lock or hide every layer except the kept one(s). Operates on the layer's own
// lock/visible flag (distinct from per-object locking).

import { describe, it, expect } from "vitest";
import { makeDocument, makeLayer, makeRect, makeGroup, solid, rgba, Ops } from "../index";

const threeLayers = () => {
  const doc = makeDocument();
  const [L0] = doc.layers; // the document's default layer
  const L1 = makeLayer("L1");
  const L2 = makeLayer("L2");
  doc.layers.push(L1, L2);
  return { doc, L0, L1, L2 };
};

describe("ops.layers.lockOtherLayers", () => {
  it("locks every layer except those kept", () => {
    const { doc, L0, L1, L2 } = threeLayers();
    expect(Ops.Layers.lockOtherLayers(doc, new Set([L1.id]))).toEqual([L0.id, L2.id]);
    expect(L0.locked).toBe(true);
    expect(L1.locked).toBe(false); // kept
    expect(L2.locked).toBe(true);
  });

  it("skips a layer that is already locked (no duplicate in the result)", () => {
    const { doc, L0, L1, L2 } = threeLayers();
    L0.locked = true;
    expect(Ops.Layers.lockOtherLayers(doc, new Set([L1.id]))).toEqual([L2.id]); // L0 omitted
    expect(L2.locked).toBe(true);
  });

  it("locks all layers when nothing is kept", () => {
    const { doc, L0, L1, L2 } = threeLayers();
    expect(Ops.Layers.lockOtherLayers(doc, new Set())).toEqual([L0.id, L1.id, L2.id]);
  });
});

describe("ops.layers.hideOtherLayers", () => {
  it("hides every layer except those kept", () => {
    const { doc, L0, L1, L2 } = threeLayers();
    expect(Ops.Layers.hideOtherLayers(doc, new Set([L1.id]))).toEqual([L0.id, L2.id]);
    expect(L0.visible).toBe(false);
    expect(L1.visible).toBe(true); // kept
    expect(L2.visible).toBe(false);
  });

  it("skips a layer that is already hidden", () => {
    const { doc, L0, L1, L2 } = threeLayers();
    L2.visible = false;
    expect(Ops.Layers.hideOtherLayers(doc, new Set([L1.id]))).toEqual([L0.id]); // L2 already hidden → omitted
    expect(L0.visible).toBe(false);
  });
});

const RED = solid(rgba(220, 0, 0, 1));

describe("ops.layers.addLayer", () => {
  it("inserts a new empty layer above the top layer with the next free name", () => {
    const doc = makeDocument(); // "Layer 1"
    const id = Ops.Layers.addLayer(doc);
    expect(doc.layers.length).toBe(2);
    expect(doc.layers[1].id).toBe(id); // appended on top
    expect(doc.layers[1].name).toBe("Layer 2");
    expect(doc.layers[1].items).toEqual([]);
  });

  it("inserts directly above a given layer", () => {
    const doc = makeDocument();
    const bottom = doc.layers[0].id;
    Ops.Layers.addLayer(doc); // Layer 2 on top
    const mid = Ops.Layers.addLayer(doc, bottom); // above the bottom layer
    expect(doc.layers[1].id).toBe(mid); // slotted between bottom and Layer 2
    expect(doc.layers[0].id).toBe(bottom);
  });

  it("skips a taken 'Layer N' name (exercises the collision loop)", () => {
    const doc = makeDocument();
    doc.layers[0].name = "Layer 2"; // the length+1 candidate (2) is already taken
    const id = Ops.Layers.addLayer(doc);
    expect(doc.layers.find((l) => l.id === id)!.name).toBe("Layer 3"); // skipped past "Layer 2"
  });

  it("falls back to inserting on top when aboveId is unknown", () => {
    const doc = makeDocument();
    const id = Ops.Layers.addLayer(doc, "missing");
    expect(doc.layers.length).toBe(2);
    expect(doc.layers[doc.layers.length - 1].id).toBe(id); // appended on top, not at a bad index
  });
});

describe("ops.layers.duplicateLayer", () => {
  it("clones a layer and its items (fresh ids) directly above it", () => {
    const doc = makeDocument();
    const r = makeRect(10, 10, 40, 30, 0, 0, { fill: RED });
    doc.layers[0].items.push(r);
    const cid = Ops.Layers.duplicateLayer(doc, doc.layers[0].id);
    expect(doc.layers.length).toBe(2);
    expect(doc.layers[1].id).toBe(cid); // copy sits above the source
    expect(doc.layers[1].name).toBe("Layer 1 copy");
    const copyItem = doc.layers[1].items[0];
    expect(copyItem.id).not.toBe(r.id); // deep clone, new id
    expect(copyItem.type).toBe("rect");
    expect(doc.layers[0].items[0].id).toBe(r.id); // original untouched
  });

  it("copies the layer's flags and returns null for an unknown id", () => {
    const doc = makeDocument();
    doc.layers[0].locked = true;
    doc.layers[0].opacity = 0.5;
    const cid = Ops.Layers.duplicateLayer(doc, doc.layers[0].id)!;
    const copy = doc.layers.find((l) => l.id === cid)!;
    expect(copy.locked).toBe(true);
    expect(copy.opacity).toBe(0.5);
    expect(Ops.Layers.duplicateLayer(doc, "nope")).toBeNull();
  });

  it("inserts the clone directly above the source, not on top of the stack", () => {
    const doc = makeDocument(); // [Layer 1]
    Ops.Layers.addLayer(doc); // [Layer 1, Layer 2]
    const cid = Ops.Layers.duplicateLayer(doc, doc.layers[0].id)!; // duplicate the BOTTOM layer
    expect(doc.layers.length).toBe(3);
    expect(doc.layers[1].id).toBe(cid); // clone sits at index 1 — above the source, below Layer 2
  });

  it("deep-clones nested art so a group's children get fresh ids too", () => {
    const doc = makeDocument();
    const child = makeRect(0, 0, 10, 10, 0, 0, { fill: RED });
    const g = makeGroup([child]);
    doc.layers[0].items.push(g);
    const cid = Ops.Layers.duplicateLayer(doc, doc.layers[0].id)!;
    const copyGroup = doc.layers.find((l) => l.id === cid)!.items[0];
    if (copyGroup.type !== "group") throw new Error("expected a group");
    expect(copyGroup.id).not.toBe(g.id);
    expect(copyGroup.children[0].id).not.toBe(child.id); // recursive re-id, no shared identity
  });
});

describe("ops.layers.removeLayer", () => {
  it("removes a layer and returns the neighbour to activate", () => {
    const doc = makeDocument();
    Ops.Layers.addLayer(doc); // [Layer 1, Layer 2]
    const top = doc.layers[1].id;
    const next = Ops.Layers.removeLayer(doc, top);
    expect(doc.layers.length).toBe(1);
    expect(next).toBe(doc.layers[0].id); // fall back to the layer below
  });

  it("refuses to remove the last remaining layer", () => {
    const doc = makeDocument();
    expect(Ops.Layers.removeLayer(doc, doc.layers[0].id)).toBeNull();
    expect(doc.layers.length).toBe(1); // untouched
  });

  it("returns null for an unknown id", () => {
    const doc = makeDocument();
    Ops.Layers.addLayer(doc);
    expect(Ops.Layers.removeLayer(doc, "nope")).toBeNull();
    expect(doc.layers.length).toBe(2);
  });
});

describe("ops.layers.flattenArtwork", () => {
  // L0 (bottom) → a0, L1 (mid) → a1, L2 (top) → a2.
  const stack = () => {
    const doc = makeDocument();
    const a0 = makeRect(0, 0, 10, 10, 0, 0, { fill: RED });
    doc.layers[0].items.push(a0);
    const L1 = makeLayer("Layer 2");
    const a1 = makeRect(20, 0, 10, 10, 0, 0, { fill: RED });
    L1.items.push(a1);
    const L2 = makeLayer("Layer 3");
    const a2 = makeRect(40, 0, 10, 10, 0, 0, { fill: RED });
    L2.items.push(a2);
    doc.layers.push(L1, L2);
    return { doc, L0: doc.layers[0], L1, L2, a0, a1, a2 };
  };

  it("merges every layer into the survivor, preserving global bottom-to-top order", () => {
    const { doc, L1, a0, a1, a2 } = stack();
    const sid = Ops.Layers.flattenArtwork(doc, L1.id);
    expect(sid).toBe(L1.id);
    expect(doc.layers.length).toBe(1);
    expect(doc.layers[0].id).toBe(L1.id); // survivor kept its identity
    expect(doc.layers[0].items.map((i) => i.id)).toEqual([a0.id, a1.id, a2.id]); // same objects, z-order intact
  });

  it("falls back to the bottom layer when the survivor id is unknown", () => {
    const { doc, L0, a0, a1, a2 } = stack();
    const sid = Ops.Layers.flattenArtwork(doc, "nope");
    expect(sid).toBe(L0.id);
    expect(doc.layers).toHaveLength(1);
    expect(doc.layers[0].items.map((i) => i.id)).toEqual([a0.id, a1.id, a2.id]);
  });

  it("is a no-op for a single-layer document", () => {
    const doc = makeDocument();
    const a = makeRect(0, 0, 10, 10, 0, 0, { fill: RED });
    doc.layers[0].items.push(a);
    expect(Ops.Layers.flattenArtwork(doc)).toBeNull();
    expect(doc.layers.length).toBe(1);
    expect(doc.layers[0].items).toEqual([a]); // untouched
  });

  it("preserves within-layer order across the merge (multiple items per layer)", () => {
    const doc = makeDocument();
    const a0 = makeRect(0, 0, 10, 10, 0, 0, { fill: RED });
    const a1 = makeRect(10, 0, 10, 10, 0, 0, { fill: RED });
    doc.layers[0].items.push(a0, a1); // bottom layer: a0 below a1
    const top = makeLayer("Layer 2");
    const b0 = makeRect(20, 0, 10, 10, 0, 0, { fill: RED });
    const b1 = makeRect(30, 0, 10, 10, 0, 0, { fill: RED });
    top.items.push(b0, b1);
    doc.layers.push(top);
    Ops.Layers.flattenArtwork(doc, top.id);
    expect(doc.layers[0].items.map((i) => i.id)).toEqual([a0.id, a1.id, b0.id, b1.id]); // bottom pair, then top pair
  });

  it("keeps the survivor's bottom identity even when art sits above it", () => {
    const { doc, L0, a0, a1, a2 } = stack();
    const sid = Ops.Layers.flattenArtwork(doc, L0.id); // survivor = the BOTTOM layer
    expect(sid).toBe(L0.id);
    expect(doc.layers[0].id).toBe(L0.id);
    expect(doc.layers[0].items.map((i) => i.id)).toEqual([a0.id, a1.id, a2.id]); // global order, not re-stacked to top
  });

  it("keeps the survivor layer's own flags and each item's own appearance", () => {
    const { doc, L1, a1 } = stack();
    L1.locked = true;
    L1.opacity = 0.5;
    a1.opacity = 0.3; // a per-item appearance
    Ops.Layers.flattenArtwork(doc, L1.id);
    expect(doc.layers[0].locked).toBe(true); // survivor flags win
    expect(doc.layers[0].opacity).toBe(0.5);
    expect(doc.layers[0].items.find((i) => i.id === a1.id)!.opacity).toBe(0.3); // item appearance intact
  });

  it("keeps hidden and locked non-survivor artwork hidden and locked", () => {
    const { doc, L0, L1, L2, a1, a2 } = stack();
    L1.visible = false;
    L2.locked = true;
    Ops.Layers.flattenArtwork(doc, L0.id);
    expect(doc.layers[0].items.find((i) => i.id === a1.id)).toMatchObject({ visible: false, locked: false });
    expect(doc.layers[0].items.find((i) => i.id === a2.id)).toMatchObject({ visible: true, locked: true });
  });

  it("falls back to the topmost visible layer when the requested survivor is hidden", () => {
    const { doc, L1, L2 } = stack();
    L2.visible = false;
    expect(Ops.Layers.flattenArtwork(doc, L2.id)).toBe(L1.id);
    expect(doc.layers[0]).toMatchObject({ id: L1.id, visible: true });
  });
});

describe("ops.layers.releaseToLayers", () => {
  it("copies the source layer flags to every released item layer", () => {
    const doc = makeDocument();
    const source = doc.layers[0];
    source.items.push(
      makeRect(0, 0, 10, 10, 0, 0, { fill: RED }),
      makeRect(20, 0, 10, 10, 0, 0, { fill: RED }),
    );
    source.visible = false;
    source.locked = true;
    source.opacity = 0.4;
    source.blendMode = "multiply";
    source.template = true;

    const ids = Ops.Layers.releaseToLayers(doc, source.id);
    expect(ids).toHaveLength(2);
    for (const id of ids) {
      expect(doc.layers.find((layer) => layer.id === id)).toMatchObject({
        visible: false,
        locked: true,
        opacity: 0.4,
        blendMode: "multiply",
        template: true,
      });
    }
  });
});

describe("ops.layers.reverseLayers", () => {
  it("flips the stacking order of every layer", () => {
    const { doc, L0, L1, L2 } = threeLayers();
    Ops.Layers.reverseLayers(doc);
    expect(doc.layers.map((l) => l.id)).toEqual([L2.id, L1.id, L0.id]);
  });

  it("reversing twice restores the original order", () => {
    const { doc, L0, L1, L2 } = threeLayers();
    Ops.Layers.reverseLayers(doc);
    Ops.Layers.reverseLayers(doc);
    expect(doc.layers.map((l) => l.id)).toEqual([L0.id, L1.id, L2.id]);
  });
});
