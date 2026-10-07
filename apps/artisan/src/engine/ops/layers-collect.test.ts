// ─────────────────────────────────────────────────────────────
// ops/layers-collect.test — Layers panel ▸ Collect in New Layer (parity)
// ─────────────────────────────────────────────────────────────
// Reference: Illustrator's "Collect in New Layer" moves the selected objects into
// a brand-new layer, preserving their relative stacking, leaving the source behind.

import { describe, it, expect } from "vitest";
import { makeDocument, makeRect, Ops, solid, rgba } from "../index";

const RED = rgba(220, 0, 0);
const BLUE = rgba(0, 0, 220);
const setup = () => {
  const doc = makeDocument();
  const a = makeRect(0, 0, 50, 50, 0, 0, { fill: solid(RED) }); // below
  const b = makeRect(60, 0, 50, 50, 0, 0, { fill: solid(BLUE) }); // above
  doc.layers[0].items.push(a, b);
  return { doc, a, b, layer0: doc.layers[0] };
};

describe("ops.layers.collectInNewLayer", () => {
  it("moves the selected items into a new top layer, emptying the source", () => {
    const { doc, a, b, layer0 } = setup();
    const lid = Ops.Layers.collectInNewLayer(doc, [a.id, b.id]);
    expect(lid).toBeTruthy();
    expect(doc.layers.length).toBe(2);
    const dest = doc.layers.find((l) => l.id === lid)!;
    expect(dest.items.map((i) => i.id)).toEqual([a.id, b.id]); // order preserved
    expect(layer0.items.length).toBe(0); // moved out of the source
    expect(doc.layers[doc.layers.length - 1].id).toBe(lid); // new layer is on top
  });

  it("collects only the selected items, leaving the rest in place", () => {
    const { doc, a, b, layer0 } = setup();
    const lid = Ops.Layers.collectInNewLayer(doc, [b.id]);
    expect(doc.layers.find((l) => l.id === lid)!.items.map((i) => i.id)).toEqual([b.id]);
    expect(layer0.items.map((i) => i.id)).toEqual([a.id]); // a stays behind
  });

  it("preserves document z-order regardless of the order ids are given", () => {
    const { doc, a, b } = setup(); // a is below b in the document
    const lid = Ops.Layers.collectInNewLayer(doc, [b.id, a.id]); // ids reversed
    expect(doc.layers.find((l) => l.id === lid)!.items.map((i) => i.id)).toEqual([a.id, b.id]);
  });

  it("returns null and creates no layer when nothing qualifies", () => {
    const { doc } = setup();
    expect(Ops.Layers.collectInNewLayer(doc, [])).toBe(null);
    expect(Ops.Layers.collectInNewLayer(doc, ["nope"])).toBe(null);
    expect(doc.layers.length).toBe(1);
  });
});
