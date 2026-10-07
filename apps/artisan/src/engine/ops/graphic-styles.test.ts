// ─────────────────────────────────────────────────────────────
// ops/graphic-styles.test — Graphic Styles (capture + apply + persist)
// ─────────────────────────────────────────────────────────────
// Reference: Illustrator's Graphic Styles save an object's appearance (fill,
// stroke, opacity, blend mode) and re-apply it to others. styleAppearance captures
// a deep-cloned bundle; applyGraphicStyle copies it onto a selection; styles are
// stored on the document and round-trip through the .artisan serializer.

import { describe, it, expect } from "vitest";
import { makeDocument, makeRect, Ops, Query, solid, rgba } from "../index";
import { serializeDocument, deserializeDocument } from "../io/json";
import type { GraphicStyle } from "../model/types";

const RED = rgba(220, 0, 0);
const BLUE = rgba(0, 0, 220);

describe("ops.graphicStyles.styleAppearance", () => {
  it("captures a deep-cloned appearance (fill / stroke / opacity / blend mode)", () => {
    const it = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(RED), opacity: 0.5 });
    it.blendMode = "multiply";
    const ap = Ops.GraphicStyles.styleAppearance(it);
    expect(ap.opacity).toBe(0.5);
    expect(ap.blendMode).toBe("multiply");
    expect(ap.fill).toEqual(solid(RED));
    // deep clone: mutating the captured paint must not touch the source item
    if (ap.fill.type === "solid") ap.fill.color.r = 0;
    expect((it.fill as { color: { r: number } }).color.r).toBe(220);
  });
});

describe("ops.graphicStyles.applyGraphicStyle", () => {
  it("copies the style's appearance onto each selected item", () => {
    const doc = makeDocument();
    const a = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(RED), opacity: 0.4 });
    a.blendMode = "screen";
    const b = makeRect(60, 0, 40, 40, 0, 0, { fill: solid(BLUE), opacity: 1 });
    Ops.Items.addItem(doc, a);
    Ops.Items.addItem(doc, b);
    const style: GraphicStyle = { id: "gs1", name: "Red", ...Ops.GraphicStyles.styleAppearance(a) };
    Ops.GraphicStyles.applyGraphicStyle(doc, [b.id], style);
    const after = Query.getItem(doc, b.id)!;
    expect(after.fill).toEqual(solid(RED));
    expect(after.opacity).toBe(0.4);
    expect(after.blendMode).toBe("screen");
    // the source object is untouched
    expect(Query.getItem(doc, a.id)!.opacity).toBe(0.4);
  });
});

describe("graphicStyles serialization", () => {
  it("round-trips graphicStyles through the .artisan serializer", () => {
    const doc = makeDocument();
    const a = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(RED) });
    doc.graphicStyles = [{ id: "gs1", name: "Red", ...Ops.GraphicStyles.styleAppearance(a) }];
    const restored = deserializeDocument(serializeDocument(doc));
    expect(restored.graphicStyles).toEqual(doc.graphicStyles);
  });
});
