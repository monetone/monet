// ops/appearance.test — Appearance panel stack operations

import { describe, expect, it } from "vitest";
import { Ops, Query, defaultStroke, makeDocument, makeGroup, makeImage, makeRect, rgba, solid } from "../index";

const RED = rgba(220, 0, 0);
const BLUE = rgba(0, 0, 220);
const GREEN = rgba(0, 170, 80);
const BLACK = rgba(0, 0, 0);

describe("Appearance panel operations", () => {
  it("promotes legacy fill/stroke to an explicit stack before editing entries", () => {
    const doc = makeDocument("Appearance");
    const rect = makeRect(0, 0, 40, 40, 0, 0, {
      fill: solid(RED),
      stroke: defaultStroke(solid(BLACK)),
    });
    doc.layers[0].items.push(rect);

    Ops.Appearance.updateEntry(doc, [rect.id], `${rect.id}:fill`, { paint: solid(BLUE), opacity: 0.5 });

    const item = Query.getItem(doc, rect.id)!;
    expect(item.appearance?.entries).toHaveLength(2);
    expect(item.appearance?.entries[0]).toMatchObject({ id: `${rect.id}:fill`, kind: "fill", opacity: 0.5, paint: solid(BLUE) });
    expect(item.fill).toEqual(solid(BLUE));
  });

  it("adds, reorders, toggles, and deletes fill/stroke entries", () => {
    const doc = makeDocument("Appearance");
    const rect = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(RED), stroke: defaultStroke(solid(BLACK)) });
    doc.layers[0].items.push(rect);

    const fill = Ops.Appearance.addFill(doc, [rect.id], solid(BLUE), { name: "Highlight" })[0];
    const stroke = Ops.Appearance.addStroke(doc, [rect.id], { ...defaultStroke(solid(GREEN)), width: 8 }, { name: "Outline" })[0];
    expect(Query.getItem(doc, rect.id)!.appearance?.entries.map((entry) => entry.name)).toEqual(["Fill", "Stroke", "Highlight", "Outline"]);

    Ops.Appearance.moveEntry(doc, [rect.id], stroke.id, "down");
    expect(Query.getItem(doc, rect.id)!.appearance?.entries.map((entry) => entry.name)).toEqual(["Fill", "Stroke", "Outline", "Highlight"]);

    Ops.Appearance.updateEntry(doc, [rect.id], fill.id, { visible: false, opacity: 2 });
    const hidden = Query.getItem(doc, rect.id)!.appearance?.entries.find((entry) => entry.id === fill.id);
    expect(hidden).toMatchObject({ visible: false, opacity: 1 });

    Ops.Appearance.deleteEntry(doc, [rect.id], fill.id);
    expect(Query.getItem(doc, rect.id)!.appearance?.entries.map((entry) => entry.name)).toEqual(["Fill", "Stroke", "Outline"]);
  });

  it("duplicates entries and keeps deleted entry effects out of the stack", () => {
    const doc = makeDocument("Appearance");
    const rect = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(RED) });
    doc.layers[0].items.push(rect);
    const fill = Ops.Appearance.addFill(doc, [rect.id], solid(BLUE), { name: "Glow Fill" })[0];
    Query.getItem(doc, rect.id)!.appearance!.effectPlacements = [
      { scope: "entry", entryId: fill.id, effect: { type: "blur", radius: 4 } },
    ];

    const copy = Ops.Appearance.duplicateEntry(doc, [rect.id], fill.id)[0];
    expect(copy.id).not.toBe(fill.id);
    expect(copy.name).toBe("Glow Fill copy");

    Ops.Appearance.deleteEntry(doc, [rect.id], fill.id);
    expect(Query.getItem(doc, rect.id)!.appearance?.effectPlacements).toEqual([]);
  });

  it("refuses paint entries on groups and images that cannot render them", () => {
    const doc = makeDocument("Appearance");
    const group = makeGroup([makeRect(0, 0, 10, 10)]);
    const image = makeImage("data:image/png;base64,", 0, 0, 10, 10);
    doc.layers[0].items.push(group, image);

    expect(Ops.Appearance.addFill(doc, [group.id, image.id], solid(BLUE))).toEqual([]);
    expect(Ops.Appearance.addStroke(doc, [group.id, image.id], defaultStroke(solid(BLUE)))).toEqual([]);
    expect(group.appearance).toBeUndefined();
    expect(image.appearance).toBeUndefined();
  });
});
