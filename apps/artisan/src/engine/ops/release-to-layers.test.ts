// ─────────────────────────────────────────────────────────────
// ops/release-to-layers.test — Layers ▸ Release to Layers (Sequence)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator "Release to Layers (Sequence)" — distributes a
// layer's top-level objects onto their own new layers, one per object, preserving
// stacking order. The source layer is kept (emptied); a group counts as one
// object → one layer.

import { describe, it, expect } from "vitest";
import { makeDocument, makeRect, makeGroup, Ops } from "../index";

const layer = () => {
  const doc = makeDocument(); // one layer "Layer 1"
  const a = makeRect(0, 0, 10, 10);
  const b = makeRect(0, 0, 10, 10);
  const c = makeRect(0, 0, 10, 10);
  doc.layers[0].items.push(a, b, c); // bottom→top: a, b, c
  return { doc, lid: doc.layers[0].id, a, b, c };
};

describe("ops.layers.releaseToLayers", () => {
  it("moves each item onto its own new layer above the (now empty) source, z-order preserved", () => {
    const { doc, lid, a, b, c } = layer();
    const created = Ops.Layers.releaseToLayers(doc, lid);

    // source kept + emptied, 3 new layers above it → 4 layers total
    expect(doc.layers).toHaveLength(4);
    expect(doc.layers[0].id).toBe(lid);
    expect(doc.layers[0].items).toHaveLength(0); // source emptied
    expect(doc.layers.slice(1).map((l) => l.items.map((i) => i.id))).toEqual([[a.id], [b.id], [c.id]]);
    // returned ids are the 3 new layers (bottom→top)
    expect(created).toEqual(doc.layers.slice(1).map((l) => l.id));
    // global stacking order (bottom→top) unchanged
    expect(doc.layers.flatMap((l) => l.items).map((i) => i.id)).toEqual([a.id, b.id, c.id]);
  });

  it("names each new layer after its item", () => {
    const doc = makeDocument();
    const a = makeRect(0, 0, 10, 10, 0, 0, { name: "Star" });
    const b = makeRect(0, 0, 10, 10, 0, 0, { name: "Moon" });
    doc.layers[0].items.push(a, b);
    Ops.Layers.releaseToLayers(doc, doc.layers[0].id);
    expect(doc.layers.slice(1).map((l) => l.name)).toEqual(["Star", "Moon"]);
  });

  it("treats a group as one item → one layer (children stay grouped)", () => {
    const doc = makeDocument();
    const x = makeRect(0, 0, 10, 10);
    const y = makeRect(0, 0, 10, 10);
    const g = makeGroup([x, y]);
    const r = makeRect(0, 0, 10, 10);
    doc.layers[0].items.push(g, r);
    Ops.Layers.releaseToLayers(doc, doc.layers[0].id);
    expect(doc.layers).toHaveLength(3); // source + group-layer + rect-layer
    const groupLayer = doc.layers[1];
    expect(groupLayer.items).toHaveLength(1);
    expect(groupLayer.items[0].type).toBe("group");
    expect((groupLayer.items[0] as { children: unknown[] }).children).toHaveLength(2);
  });

  it("is a no-op (returns []) for fewer than two items", () => {
    const doc = makeDocument();
    doc.layers[0].items.push(makeRect(0, 0, 10, 10));
    expect(Ops.Layers.releaseToLayers(doc, doc.layers[0].id)).toEqual([]);
    expect(doc.layers).toHaveLength(1); // untouched
    expect(doc.layers[0].items).toHaveLength(1);
  });

  it("is a no-op for an unknown layer id", () => {
    const { doc } = layer();
    expect(Ops.Layers.releaseToLayers(doc, "nope")).toEqual([]);
    expect(doc.layers).toHaveLength(1);
  });
});
