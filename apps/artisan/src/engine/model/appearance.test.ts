// model/appearance.test - Illustrator-style Appearance stack baseline

import { describe, it, expect } from "vitest";
import {
  IO,
  Ops,
  Query,
  defaultStroke,
  makeDocument,
  makeRect,
  paintedFill,
  paintedStroke,
  rgba,
  solid,
  type AppearanceStack,
  type Paint,
} from "../index";

const RED = rgba(220, 0, 0);
const BLUE = rgba(0, 0, 220);
const GREEN = rgba(0, 160, 60);
const BLACK = rgba(0, 0, 0);

const stacked = (): AppearanceStack => ({
  entries: [
    { id: "fill-base", name: "Base Fill", kind: "fill", paint: solid(RED) },
    { id: "fill-top", name: "Top Fill", kind: "fill", paint: solid(BLUE), opacity: 0.5 },
    { id: "stroke-top", name: "Top Stroke", kind: "stroke", stroke: { ...defaultStroke(solid(GREEN)), width: 6 } },
  ],
  effectPlacements: [
    { scope: "entry", entryId: "fill-top", effect: { type: "blur", radius: 2 } },
  ],
});

const solidColors = (ps: Paint[]) => ps.map((p) => (p.type === "solid" ? p.color : null));

describe("Appearance stack model", () => {
  it("round-trips explicit appearance stacks through .artisan JSON", () => {
    const doc = makeDocument();
    const rect = makeRect(0, 0, 40, 40, 0, 0, {
      fill: solid(RED),
      stroke: defaultStroke(solid(BLACK)),
      appearance: stacked(),
    });
    doc.layers[0].items.push(rect);
    doc.graphicStyles = [{ id: "gs1", name: "Stacked", ...Ops.GraphicStyles.styleAppearance(rect) }];

    const restored = IO.deserializeDocument(IO.serializeDocument(doc));
    const item = restored.layers[0].items[0];
    expect(item.appearance).toEqual(rect.appearance);
    expect(restored.graphicStyles?.[0].appearance).toEqual(rect.appearance);
  });

  it("applies a graphic style's stack and syncs legacy primary fields", () => {
    const doc = makeDocument();
    const source = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(RED), appearance: stacked() });
    const target = makeRect(80, 0, 40, 40, 0, 0, { fill: solid(BLACK), stroke: defaultStroke(solid(BLACK)) });
    doc.layers[0].items.push(source, target);

    Ops.GraphicStyles.applyGraphicStyle(doc, [target.id], { id: "gs1", name: "Stacked", ...Ops.GraphicStyles.styleAppearance(source) });

    const after = Query.getItem(doc, target.id)!;
    expect(after.appearance).toEqual(source.appearance);
    expect(after.fill).toEqual(solid(BLUE));
    expect(after.stroke.paint).toEqual(solid(GREEN));
  });

  it("updates the top painted fill/stroke entries when primary paint ops edit a stacked item", () => {
    const doc = makeDocument();
    const rect = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(RED), appearance: stacked() });
    doc.layers[0].items.push(rect);

    Ops.Paint.applyFill(doc, [rect.id], solid(GREEN));
    Ops.Paint.setStrokeWidth(doc, [rect.id], 12);

    const after = Query.getItem(doc, rect.id)!;
    expect(after.fill).toEqual(solid(GREEN));
    expect(after.appearance?.entries[1]).toMatchObject({ kind: "fill", paint: solid(GREEN) });
    expect(after.stroke.width).toBe(12);
    expect(after.appearance?.entries[2]).toMatchObject({ kind: "stroke", stroke: { width: 12 } });
  });

  it("edits visible painted entries instead of hidden or none primaries", () => {
    const doc = makeDocument();
    const appearance = stacked();
    appearance.entries[0].visible = false;
    appearance.entries.unshift({ id: "stroke-none", kind: "stroke", stroke: defaultStroke() });
    const rect = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(RED), appearance });
    doc.layers[0].items.push(rect);

    Ops.Paint.applyFill(doc, [rect.id], solid(GREEN));
    Ops.Paint.setStrokeWidth(doc, [rect.id], 12);

    expect(rect.appearance!.entries[2]).toMatchObject({ kind: "fill", paint: solid(GREEN) });
    expect(rect.appearance!.entries[3]).toMatchObject({ kind: "stroke", stroke: { paint: solid(GREEN), width: 12 } });
    expect(rect.fill).toEqual(solid(GREEN));
    expect(rect.stroke.paint).toEqual(solid(GREEN));
    expect(rect.stroke.width).toBe(12);
  });

  it("resolves the topmost visible painted fill and stroke", () => {
    const rect = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(RED), appearance: stacked() });
    rect.appearance!.entries[1].visible = false;
    rect.appearance!.entries.push(
      { id: "fill-visible", kind: "fill", paint: solid(GREEN) },
      { id: "stroke-visible", kind: "stroke", stroke: { ...defaultStroke(solid(BLUE)), width: 12 } },
    );

    expect(paintedFill(rect)).toEqual(solid(GREEN));
    expect(paintedStroke(rect)).toMatchObject({ paint: solid(BLUE), width: 12 });
  });

  it("includes extra stack fills and strokes in Add Used Colors", () => {
    const doc = makeDocument();
    doc.swatches = [];
    doc.layers[0].items.push(makeRect(0, 0, 40, 40, 0, 0, { fill: solid(BLACK), appearance: stacked() }));

    expect(solidColors(Query.usedColorsNotInSwatches(doc))).toEqual([RED, BLUE, GREEN]);
  });
});
