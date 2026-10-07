// ops/dimensions.test - dimension object lifecycle

import { describe, expect, it } from "vitest";
import {
  IO,
  Ops,
  Query,
  makeDocument,
  makeDimensionGroup,
  type GroupItem,
  type TextItem,
} from "../index";

const group = (doc: ReturnType<typeof makeDocument>, id: string): GroupItem =>
  Query.getItem(doc, id) as GroupItem;

const labelText = (item: GroupItem): string | undefined =>
  item.children.find((child): child is TextItem => child.type === "text")?.text;

const addDimension = (
  doc: ReturnType<typeof makeDocument>,
  start = { x: 0, y: 0 },
  end = { x: 100, y: 0 },
  opts: Parameters<typeof makeDimensionGroup>[2] = {},
) => {
  const group = makeDimensionGroup(start, end, opts);
  Ops.Items.addItem(doc, group);
  return group.id;
};

describe("dimension operations", () => {
  it("creates queryable live dimension groups", () => {
    const doc = makeDocument("Dimensions");

    const id = addDimension(doc, { x: 10, y: 20 }, { x: 70, y: 20 }, {
      units: "mm",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(group(doc, id).dimension).toMatchObject({ id, kind: "linear", length: 60, units: "mm" });
    expect(labelText(group(doc, id))).toBe("60 mm");
    expect(Query.dimensionEntries(doc)[0]).toMatchObject({
      itemId: id,
      layerName: "Layer 1",
      length: 60,
      label: "60 mm",
    });
  });

  it("updates options and regenerates dimension label artwork", () => {
    const doc = makeDocument("Dimension Update");
    const id = addDimension(doc, { x: 0, y: 0 }, { x: 33.333, y: 0 });

    expect(Ops.Dimensions.setDimensionOptions(doc, id, { units: "pt", precision: 2 }, { now: "2026-02-02T00:00:00.000Z" })).toBe(true);

    expect(group(doc, id).dimension).toMatchObject({ units: "pt", precision: 2, updatedAt: "2026-02-02T00:00:00.000Z" });
    expect(labelText(group(doc, id))).toBe("33.33 pt");
  });

  it("round-trips dimension metadata through the native JSON format", () => {
    const doc = makeDocument("Dimension Roundtrip");
    const id = addDimension(doc, { x: 0, y: 0 }, { x: 0, y: 25 }, { label: "height" });

    const back = IO.deserializeDocument(IO.serializeDocument(doc));

    expect(group(back, id).dimension).toEqual(group(doc, id).dimension);
    expect(Query.dimensionEntries(back)[0]).toMatchObject({ itemId: id, label: "height" });
  });

  it("detaches a dimension without deleting generated artwork", () => {
    const doc = makeDocument("Dimension Detach");
    const id = addDimension(doc);
    const before = group(doc, id).children.length;

    expect(Ops.Dimensions.detachDimension(doc, [id])).toEqual([id]);

    expect(group(doc, id).dimension).toBeUndefined();
    expect(group(doc, id).children).toHaveLength(before);
    expect(Query.dimensionEntries(doc)).toHaveLength(0);
  });

  it("duplicates dimension metadata with the cloned group id", () => {
    const doc = makeDocument("Dimension Duplicate");
    const id = addDimension(doc);

    const duplicateId = Ops.Items.duplicateItems(doc, [id], 12, 8)[0];

    expect(duplicateId).toBeTruthy();
    expect(group(doc, duplicateId).dimension?.id).toBe(duplicateId);
    expect(group(doc, duplicateId).dimension?.id).not.toBe(id);
    expect(Query.dimensionEntries(doc).map((entry) => entry.itemId)).toEqual([id, duplicateId]);
  });
});
