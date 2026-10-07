// ─────────────────────────────────────────────────────────────
// model/query.test — itemsOnSameLayers (Select ▸ Object ▸ All on Same Layers)
// ─────────────────────────────────────────────────────────────
// Unit-tests the pure query behind Illustrator's "All on Same Layers": the
// selectable top-level objects on the layer(s) that own the current selection.

import { describe, it, expect } from "vitest";
import { makeDocument, makeRect, makeLayer, makeGroup, Query, solid, defaultStroke, rgba } from "../index";

const rect = (x: number) => makeRect(x, 0, 40, 40, 0, 0, { fill: solid(rgba(200, 100, 100)) });

// Two layers: L0 = [a, b], L1 = [c, d].
const setup = () => {
  const doc = makeDocument();
  const [a, b, c, d] = [rect(0), rect(50), rect(100), rect(150)];
  doc.layers[0].items.push(a, b);
  const l1 = makeLayer("Layer 2", [c, d]);
  doc.layers.push(l1);
  return { doc, a, b, c, d, l0: doc.layers[0], l1 };
};
const sorted = (ids: string[]) => ids.slice().sort();

describe("Query.itemsOnSameLayers", () => {
  it("returns every top-level object on the selection's layer (and no other layer)", () => {
    const { doc, a, b } = setup();
    expect(sorted(Query.itemsOnSameLayers(doc, [a.id]))).toEqual(sorted([a.id, b.id]));
  });

  it("spans every layer that owns a selected object", () => {
    const { doc, a, b, c, d } = setup();
    expect(sorted(Query.itemsOnSameLayers(doc, [a.id, c.id]))).toEqual(sorted([a.id, b.id, c.id, d.id]));
  });

  it("skips locked and hidden items on the layer", () => {
    const { doc, a, b } = setup();
    b.locked = true;
    expect(Query.itemsOnSameLayers(doc, [a.id])).toEqual([a.id]);
    b.locked = false;
    b.visible = false;
    expect(Query.itemsOnSameLayers(doc, [a.id])).toEqual([a.id]);
  });

  it("skips a locked layer entirely (even if a selected id lives on it)", () => {
    const { doc, a, b, c, l1 } = setup();
    l1.locked = true;
    expect(sorted(Query.itemsOnSameLayers(doc, [a.id, c.id]))).toEqual(sorted([a.id, b.id]));
  });

  it("resolves a nested selection to its owning layer (returns top-level items)", () => {
    const { doc, a, b } = setup();
    const child = rect(200);
    const g = makeGroup([child]);
    doc.layers[0].items.push(g);
    // selecting the child inside the group still selects everything on L0
    expect(sorted(Query.itemsOnSameLayers(doc, [child.id]))).toEqual(sorted([a.id, b.id, g.id]));
  });

  it("is empty when nothing is selected", () => {
    const { doc } = setup();
    expect(Query.itemsOnSameLayers(doc, [])).toEqual([]);
  });
});

describe("Query.unusedSwatchIndices", () => {
  const RED = rgba(220, 0, 0);
  const BLUE = rgba(0, 0, 220);
  const GREEN = rgba(0, 220, 0);

  it("returns the indices of swatches no artwork references (by fill)", () => {
    const doc = makeDocument();
    doc.swatches = [solid(RED), solid(BLUE), solid(GREEN)];
    doc.layers[0].items.push(makeRect(0, 0, 10, 10, 0, 0, { fill: solid(BLUE) })); // only BLUE used
    expect(Query.unusedSwatchIndices(doc)).toEqual([0, 2]); // RED + GREEN unused
  });

  it("counts a swatch matching a stroke paint as used", () => {
    const doc = makeDocument();
    doc.swatches = [solid(RED), solid(BLUE)];
    doc.layers[0].items.push(makeRect(0, 0, 10, 10, 0, 0, { fill: solid(GREEN), stroke: defaultStroke(solid(RED)) }));
    expect(Query.unusedSwatchIndices(doc)).toEqual([1]); // RED used by the stroke; BLUE unused
  });

  it("counts a swatch used only by an object nested in a group", () => {
    const doc = makeDocument();
    doc.swatches = [solid(RED)];
    const nested = makeRect(0, 0, 10, 10, 0, 0, { fill: solid(RED) });
    doc.layers[0].items.push(makeGroup([nested]));
    expect(Query.unusedSwatchIndices(doc)).toEqual([]); // RED used by the nested rect
  });

  it("returns [] when every swatch is used", () => {
    const doc = makeDocument();
    doc.swatches = [solid(RED), solid(BLUE)];
    doc.layers[0].items.push(makeRect(0, 0, 10, 10, 0, 0, { fill: solid(RED) }), makeRect(20, 0, 10, 10, 0, 0, { fill: solid(BLUE) }));
    expect(Query.unusedSwatchIndices(doc)).toEqual([]);
  });

  it("marks every swatch unused in an empty document", () => {
    const doc = makeDocument();
    doc.swatches = [solid(RED), solid(BLUE)];
    expect(Query.unusedSwatchIndices(doc)).toEqual([0, 1]);
  });
});
