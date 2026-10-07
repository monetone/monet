// ─────────────────────────────────────────────────────────────
// ops/brushes.test — Brushes panel engine operations
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { IO, Ops, Query, defaultStroke, makeDocument, makeGroup, makeLine, makeRect, noPaint, paintedStroke, rgba, solid } from "../index";

describe("brush operations", () => {
  it("seeds new documents with a default calligraphic brush", () => {
    const doc = makeDocument("Brushes");

    expect(Query.brushDefinitionEntries(doc)).toHaveLength(1);
    expect(Query.brushDefinitionEntries(doc)[0].brush).toMatchObject({
      name: "Basic Calligraphic",
      kind: "calligraphic",
      size: 10,
      angle: -45,
      roundness: 1,
    });
  });

  it("adds, updates, duplicates, and deletes calligraphic brushes", () => {
    const doc = makeDocument("Brush Library");
    const marker = Ops.Brushes.addCalligraphicBrush(doc, {
      name: "Marker",
      size: 24,
      angle: 10,
      roundness: 0.5,
      now: "2026-06-02T00:00:00.000Z",
    });

    expect(doc.brushes).toHaveLength(2);
    expect(marker.createdAt).toBe("2026-06-02T00:00:00.000Z");

    Ops.Brushes.updateCalligraphicBrush(doc, marker.id, {
      size: 28,
      roundness: 1.5,
      now: "2026-06-03T00:00:00.000Z",
    });
    expect(Ops.Brushes.getBrushDefinition(doc, marker.id)).toMatchObject({
      size: 28,
      roundness: 1,
      updatedAt: "2026-06-03T00:00:00.000Z",
    });

    const copy = Ops.Brushes.duplicateBrush(doc, marker.id, { name: "Marker copy" });
    expect(copy?.id).not.toBe(marker.id);
    expect(copy).toMatchObject({ name: "Marker copy", size: 28 });

    expect(Ops.Brushes.deleteBrushDefinition(doc, marker.id)).toBe(true);
    expect(doc.brushes?.map((brush) => brush.name)).toEqual(["Basic Calligraphic", "Marker copy"]);
  });

  it("applies a brush visibly to selected strokes and records usage metadata", () => {
    const doc = makeDocument("Apply Brush");
    const rect = makeRect(0, 0, 40, 40, 0, 0, {
      fill: noPaint(),
      stroke: defaultStroke(solid(rgba(0, 0, 0))),
    });
    const line = makeLine(0, 0, 100, 0);
    Ops.Items.addItems(doc, [rect, line]);
    const brush = Ops.Brushes.addCalligraphicBrush(doc, { name: "Thick", size: 22, angle: 30 });

    expect(Ops.Brushes.applyBrushToItems(doc, [rect.id, line.id], brush.id, {
      appliedAt: "2026-06-04T00:00:00.000Z",
    })).toEqual([rect.id, line.id]);

    expect(rect.stroke).toMatchObject({ width: 22, cap: "round", join: "round" });
    expect(rect.brush).toMatchObject({
      brushId: brush.id,
      brushName: "Thick",
      expanded: false,
      appliedAt: "2026-06-04T00:00:00.000Z",
    });
    expect(Query.brushDefinitionEntries(doc).find((entry) => entry.brush.id === brush.id)?.usageCount).toBe(2);
  });

  it("applies a brush to every leaf of a selected nested group", () => {
    const doc = makeDocument("Grouped Brush");
    const rect = makeRect(0, 0, 40, 40);
    const line = makeLine(0, 0, 100, 0);
    const group = makeGroup([makeGroup([rect]), line]);
    Ops.Items.addItem(doc, group);
    const brush = Ops.Brushes.addCalligraphicBrush(doc, { name: "Grouped", size: 18 });

    expect(Ops.Brushes.applyBrushToItems(doc, [group.id], brush.id)).toEqual([rect.id, line.id]);
    expect([rect, line].map((item) => [item.stroke.width, item.brush?.brushId])).toEqual([
      [18, brush.id],
      [18, brush.id],
    ]);
  });

  it("updates the visible stroke in an Appearance stack", () => {
    const doc = makeDocument("Stacked Brush");
    const rect = makeRect(0, 0, 40, 40);
    rect.appearance = {
      entries: [{ id: "visible-stroke", kind: "stroke", stroke: { ...defaultStroke(solid(rgba(0, 0, 0))), width: 3 } }],
    };
    Ops.Items.addItem(doc, rect);
    const brush = Ops.Brushes.addCalligraphicBrush(doc, { name: "Stacked", size: 24 });

    expect(Ops.Brushes.applyBrushToItems(doc, [rect.id], brush.id)).toEqual([rect.id]);
    expect(paintedStroke(rect)).toMatchObject({ width: 24, cap: "round", join: "round" });
  });

  it("round-trips brush definitions and applications through native JSON", () => {
    const doc = makeDocument("Brush Roundtrip");
    const rect = makeRect(0, 0, 40, 40);
    Ops.Items.addItem(doc, rect);
    const brush = Ops.Brushes.addCalligraphicBrush(doc, { name: "Roundtrip", size: 16 });
    Ops.Brushes.applyBrushToItems(doc, [rect.id], brush.id);

    const back = IO.deserializeDocument(IO.serializeDocument(doc));

    expect(back.brushes).toEqual(doc.brushes);
    expect(Query.getItem(back, rect.id)?.brush).toEqual(Query.getItem(doc, rect.id)?.brush);
  });
});
