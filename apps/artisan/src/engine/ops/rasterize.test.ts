// ─────────────────────────────────────────────────────────────
// ops/rasterize.test — Object ▸ Rasterize (selectionToSvg + rasterize)
// ─────────────────────────────────────────────────────────────
// Reference: Illustrator Object ▸ Rasterize replaces the selected vector artwork
// with a pixel image at its bounds. selectionToSvg builds the selection-only SVG
// (the caller rasterizes it to a PNG); rasterize swaps the selection for one
// ImageItem painted from that PNG, at the selection's combined world bounds.

import { describe, it, expect } from "vitest";
import { makeDocument, makeRect, Ops, Query, solid, rgba } from "../index";

const RED = rgba(220, 0, 0);
const BLUE = rgba(0, 0, 220);
const STUB = "data:image/png;base64,STUB";

const setup = () => {
  const doc = makeDocument();
  const a = makeRect(10, 20, 40, 40, 0, 0, { fill: solid(RED) });
  const b = makeRect(120, 30, 40, 40, 0, 0, { fill: solid(BLUE) });
  Ops.Items.addItem(doc, a); // bottom
  Ops.Items.addItem(doc, b); // top (frontmost)
  return { doc, a, b };
};

describe("ops.rasterize.selectionToSvg", () => {
  it("renders only the selected items, clipped to the region", () => {
    const { doc, a } = setup();
    const region = Query.selectionBounds(doc, [a.id])!;
    const svg = Ops.Rasterize.selectionToSvg(doc, [a.id], region);
    expect(svg).toContain("rgb(220,0,0)"); // the selected red rect is present
    expect(svg).not.toContain("rgb(0,0,220)"); // the non-selected blue rect is absent
    expect(svg).toContain('viewBox="10 20 40 40"'); // viewBox = the selection bounds
    expect((svg.match(/<rect/g) || []).length).toBe(1); // exactly one shape, no background
  });

  it("renders every selected item when more than one is chosen", () => {
    const { doc, a, b } = setup();
    const region = Query.selectionBounds(doc, [a.id, b.id])!;
    const svg = Ops.Rasterize.selectionToSvg(doc, [a.id, b.id], region);
    expect(svg).toContain("rgb(220,0,0)");
    expect(svg).toContain("rgb(0,0,220)");
    expect((svg.match(/<rect/g) || []).length).toBe(2);
  });
});

describe("ops.rasterize.rasterize", () => {
  it("replaces a single selected item with an image at its bounds", () => {
    const { doc, a, b } = setup();
    const id = Ops.Rasterize.rasterize(doc, [a.id], STUB, 2);
    expect(id).toBeTruthy();
    const items = doc.layers[0].items;
    expect(items.length).toBe(2); // image + untouched b
    expect(Query.getItem(doc, a.id)).toBeNull(); // a was replaced
    expect(Query.getItem(doc, b.id)).toBeTruthy(); // b untouched
    const img = Query.getItem(doc, id!)!;
    expect(img.type).toBe("image");
    if (img.type === "image") {
      expect(img.href).toBe(STUB);
      expect(img.width).toBe(40);
      expect(img.height).toBe(40);
      expect(img.naturalWidth).toBe(80); // 40 * scale(2)
      expect(img.naturalHeight).toBe(80);
    }
    expect(img.transform.e).toBe(10); // translated to bounds.x
    expect(img.transform.f).toBe(20); // translated to bounds.y
    // the image takes the replaced item's z-position (a was at the bottom)
    expect(items[0].id).toBe(id);
  });

  it("collapses a multi-item selection into one image at the union bounds (frontmost z-order)", () => {
    const { doc, a, b } = setup();
    const id = Ops.Rasterize.rasterize(doc, [a.id, b.id], STUB, 2);
    const items = doc.layers[0].items;
    expect(items.length).toBe(1);
    expect(items[0].id).toBe(id);
    const img = items[0];
    expect(img.transform.e).toBe(10); // union x
    expect(img.transform.f).toBe(20); // union y
    if (img.type === "image") {
      expect(img.width).toBe(150); // 120 + 40 − 10
      expect(img.height).toBe(50); // 30 + 40 − 20
    }
  });

  it("is a no-op (returns null, mutates nothing) with an empty selection", () => {
    const { doc } = setup();
    const before = doc.layers[0].items.length;
    expect(Ops.Rasterize.rasterize(doc, [], STUB, 2)).toBeNull();
    expect(doc.layers[0].items.length).toBe(before);
  });
});
