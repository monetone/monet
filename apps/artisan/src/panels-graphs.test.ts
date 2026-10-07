// panels-graphs.test — Graphs panel store transactions

import { describe, expect, it } from "vitest";
import {
  ArtisanStore,
  Ops,
  Query,
  formatGraphDataText,
  makeGraphGroup,
  makeDocument,
  parseGraphDataText,
  type GroupItem,
} from "./engine";

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument("Panel Graphs");
  const group = makeGraphGroup("column", { x: 10, y: 20 }, { x: 130, y: 100 }, {
    data: [
      { label: "A", value: 1 },
      { label: "B", value: 2 },
    ],
  });
  Ops.Items.addItem(doc, group);
  const id = group.id;
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([id]);
  return { store, id };
};

const graphGroup = (store: ArtisanStore, id: string): GroupItem =>
  Query.getItem(store.getState().doc, id) as GroupItem;

describe("Graphs panel transactions", () => {
  it("updates graph data and type through undoable transactions", () => {
    const { store, id } = setup();
    const parsed = parseGraphDataText(["Label,Value,X", "North,4,10", "South,9,20", "West,2,30"].join("\n"));

    store.transact("Edit Graph Data", (doc) => {
      Ops.Graphs.updateGraphData(doc, id, parsed.data, { now: "2026-07-03T00:00:00.000Z" });
    });

    expect(parsed.errors).toHaveLength(0);
    expect(graphGroup(store, id).graph?.data.map((datum) => datum.label)).toEqual(["North", "South", "West"]);
    expect(Query.graphEntries(store.getState().doc)[0]).toMatchObject({ itemId: id, datumCount: 3 });

    store.transact("Graph Type", (doc) => {
      Ops.Graphs.setGraphOptions(doc, id, { kind: "scatter", showAxes: false });
    });

    expect(graphGroup(store, id).graph).toMatchObject({ id, kind: "scatter", showAxes: false });
    expect(formatGraphDataText(graphGroup(store, id).graph!.data)).toContain("Label,Value,X");

    store.undo();
    expect(graphGroup(store, id).graph).toMatchObject({ kind: "column" });

    store.undo();
    expect(graphGroup(store, id).graph?.data.map((datum) => datum.label)).toEqual(["A", "B"]);
  });

  it("detaches a graph through an undoable transaction", () => {
    const { store, id } = setup();

    store.transact("Detach Graph", (doc) => {
      Ops.Graphs.detachGraph(doc, [id]);
    });

    expect(Query.graphEntries(store.getState().doc)).toHaveLength(0);
    expect(graphGroup(store, id).children.length).toBeGreaterThan(0);

    store.undo();
    expect(Query.graphEntries(store.getState().doc)).toHaveLength(1);
  });
});
