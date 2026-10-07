// panels-variables.test - Variables panel store transactions

import { describe, expect, it } from "vitest";
import { ArtisanStore, Ops, makeDocument, makeText } from "./engine";

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument("Panel Variables");
  const label = makeText("Alpha", 0, 0);
  doc.layers[0].items.push(label);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([label.id]);
  return { store, label };
};

describe("Variables panel transactions", () => {
  it("creates variables and data sets as undoable transactions", () => {
    const { store } = setup();

    store.transact("New Variable", (doc) => {
      Ops.Variables.createVariableFromSelection(doc, store.getState().selection, "text", "Headline");
    });

    let state = store.getState();
    const variable = state.doc.variables!.variables[0];
    expect(variable).toMatchObject({ name: "Headline", kind: "text" });
    expect(state.dirty).toBe(true);

    store.transact("Capture Data Set", (doc) => {
      Ops.Variables.captureDataSet(doc, "Default Copy");
    });

    state = store.getState();
    expect(state.doc.variables!.dataSets[0].values[variable.id]).toEqual({ text: "Alpha" });

    store.transact("Apply Data Set", (doc) => {
      Ops.Variables.setDataSetValue(doc, state.doc.variables!.dataSets[0].id, variable.id, { text: "Beta" });
      Ops.Variables.applyDataSet(doc, state.doc.variables!.dataSets[0].id);
    });
    expect((store.getState().doc.layers[0].items[0] as { text: string }).text).toBe("Beta");

    store.undo();
    expect((store.getState().doc.layers[0].items[0] as { text: string }).text).toBe("Alpha");
  });
});
