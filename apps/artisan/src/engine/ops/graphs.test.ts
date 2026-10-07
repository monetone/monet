// ─────────────────────────────────────────────────────────────
// ops/graphs.test — graph object lifecycle and regeneration
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import {
  IO,
  Ops,
  Query,
  makeDocument,
  makeGraphGroup,
  type GroupItem,
  type RectItem,
} from "../index";

const group = (doc: ReturnType<typeof makeDocument>, id: string): GroupItem =>
  Query.getItem(doc, id) as GroupItem;

const addGraph = (
  doc: ReturnType<typeof makeDocument>,
  kind: Parameters<typeof makeGraphGroup>[0],
  start: Parameters<typeof makeGraphGroup>[1],
  end: Parameters<typeof makeGraphGroup>[2],
  opts: Parameters<typeof makeGraphGroup>[3] = {},
) => {
  const graph = makeGraphGroup(kind, start, end, opts);
  Ops.Items.addItem(doc, graph);
  return graph.id;
};

const barCount = (item: GroupItem): number =>
  item.children.filter((child): child is RectItem => child.type === "rect").length;

describe("graph operations", () => {
  it("creates queryable graph groups with source data", () => {
    const doc = makeDocument("Graphs");

    const id = addGraph(doc, "bar", { x: 10, y: 20 }, { x: 110, y: 80 }, {
      data: [
        { label: "Q1", value: 12 },
        { label: "Q2", value: 8 },
      ],
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(doc.layers[0].items).toHaveLength(1);
    expect(group(doc, id).graph).toMatchObject({ id, kind: "bar", width: 100, height: 60 });
    expect(barCount(group(doc, id))).toBe(2);
    expect(Query.graphEntries(doc)[0]).toMatchObject({
      itemId: id,
      kind: "bar",
      datumCount: 2,
      layerName: "Layer 1",
    });
  });

  it("updates graph data and regenerates artwork from the new dataset", () => {
    const doc = makeDocument("Graph Update");
    const id = addGraph(doc, "column", { x: 0, y: 0 }, { x: 120, y: 80 }, {
      data: [
        { label: "A", value: 1 },
        { label: "B", value: 2 },
        { label: "C", value: 3 },
      ],
    });

    expect(barCount(group(doc, id))).toBe(3);
    expect(Ops.Graphs.updateGraphData(doc, id, [{ label: "Only", value: 9 }], { now: "2026-02-02T00:00:00.000Z" })).toBe(true);

    expect(group(doc, id).graph?.data).toEqual([{ label: "Only", value: 9 }]);
    expect(group(doc, id).graph?.updatedAt).toBe("2026-02-02T00:00:00.000Z");
    expect(barCount(group(doc, id))).toBe(1);
  });

  it("round-trips graph metadata through the native JSON format", () => {
    const doc = makeDocument("Graph Roundtrip");
    const id = addGraph(doc, "scatter", { x: 0, y: 0 }, { x: 100, y: 100 }, {
      data: [
        { label: "A", x: 10, value: 2 },
        { label: "B", x: 20, value: 4 },
      ],
    });

    const back = IO.deserializeDocument(IO.serializeDocument(doc));

    expect(group(back, id).graph).toEqual(group(doc, id).graph);
    expect(Query.graphEntries(back)[0]).toMatchObject({ itemId: id, kind: "scatter", datumCount: 2 });
  });

  it("detaches a graph without deleting the generated artwork", () => {
    const doc = makeDocument("Graph Detach");
    const id = addGraph(doc, "pie", { x: 50, y: 50 }, { x: 90, y: 50 });
    const before = group(doc, id).children.length;

    expect(Ops.Graphs.detachGraph(doc, [id])).toEqual([id]);

    expect(group(doc, id).graph).toBeUndefined();
    expect(group(doc, id).children).toHaveLength(before);
    expect(Query.graphEntries(doc)).toHaveLength(0);
  });

  it("duplicates graph metadata with the cloned group id", () => {
    const doc = makeDocument("Graph Duplicate");
    const id = addGraph(doc, "area", { x: 0, y: 0 }, { x: 100, y: 80 });

    const duplicateId = Ops.Items.duplicateItems(doc, [id], 12, 8)[0];

    expect(duplicateId).toBeTruthy();
    expect(group(doc, duplicateId).graph?.id).toBe(duplicateId);
    expect(group(doc, duplicateId).graph?.id).not.toBe(id);
    expect(Query.graphEntries(doc).map((entry) => entry.itemId)).toEqual([id, duplicateId]);
  });
});
