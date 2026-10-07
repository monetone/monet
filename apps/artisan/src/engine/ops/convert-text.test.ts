// ─────────────────────────────────────────────────────────────
// ops/convert-text.test — Type ▸ Convert to Area / Point Type (parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Type menu — point text (auto-width) ↔ area text
// (fixed box). point→area boxes the text at its current extent; area→point drops
// the box. Type-on-a-path is neither and is left alone.

import { describe, it, expect } from "vitest";
import { makeDocument, makeText, makeRect, Ops, Query, Shapes } from "../index";
import type { TextItem } from "../index";

const txt = (doc: ReturnType<typeof makeDocument>, id: string) => Query.getItem(doc, id) as TextItem;

describe("ops.text.convertText", () => {
  it("point → area gives the text a box matching its current extent", () => {
    const doc = makeDocument();
    const t = makeText("Hello world", 0, 0); // point text (no box)
    Ops.Items.addItem(doc, t);
    const extent = Shapes.estimateTextBounds(txt(doc, t.id)); // measure while still point text
    expect(Ops.Text.convertText(doc, [t.id], "area")).toEqual([t.id]);
    expect(txt(doc, t.id).boxWidth).toBe(extent.width);
    expect(txt(doc, t.id).boxHeight).toBe(extent.height);
  });

  it("area → point clears the box (back to auto-width)", () => {
    const doc = makeDocument();
    const t = makeText("Boxed", 0, 0);
    t.boxWidth = 200;
    t.boxHeight = 80;
    Ops.Items.addItem(doc, t);
    expect(Ops.Text.convertText(doc, [t.id], "point")).toEqual([t.id]);
    expect(txt(doc, t.id).boxWidth).toBeUndefined();
    expect(txt(doc, t.id).boxHeight).toBeUndefined();
  });

  it("is a no-op when the text is already the requested kind", () => {
    const doc = makeDocument();
    const t = makeText("Point", 0, 0); // already point
    Ops.Items.addItem(doc, t);
    expect(Ops.Text.convertText(doc, [t.id], "point")).toEqual([]);
    expect(txt(doc, t.id).boxWidth).toBeUndefined();
  });

  it("skips type-on-a-path text (pathD set)", () => {
    const doc = makeDocument();
    const t = makeText("On a path", 0, 0);
    t.pathD = "M0 0 L100 0";
    Ops.Items.addItem(doc, t);
    expect(Ops.Text.convertText(doc, [t.id], "area")).toEqual([]);
    expect(txt(doc, t.id).boxWidth).toBeUndefined(); // untouched
  });

  it("ignores non-text items", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 50, 50, 0, 0);
    Ops.Items.addItem(doc, r);
    expect(Ops.Text.convertText(doc, [r.id], "area")).toEqual([]);
  });
});
