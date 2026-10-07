// panels-actions.test - Actions panel store transactions

import { describe, expect, it } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, IO, Query, makeDocument, makeRect } from "./engine";

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument("Panel Actions");
  const back = makeRect(0, 0, 40, 40);
  const front = makeRect(60, 0, 40, 40);
  doc.layers[0].items.push(back, front);
  store.replaceDoc(doc, { markClean: true });
  return { store, back, front };
};

const actionId = (store: ArtisanStore): string => store.getState().doc.actions![0].id;

describe("Actions panel transactions", () => {
  it("creates, edits, and serializes document-backed actions", () => {
    const { store } = setup();

    const id = commands.newAction(store, "Duplicate Forward")!;
    commands.appendActionStep(store, id, "bring-to-front");

    let action = store.getState().doc.actions![0];
    expect(action.name).toBe("Duplicate Forward");
    expect(action.steps.map((step) => step.command)).toEqual(["duplicate", "bring-to-front"]);

    commands.setActionStepEnabled(store, id, action.steps[0].id, false);
    expect(store.getState().doc.actions![0].steps[0].enabled).toBe(false);

    commands.renameAction(store, id, "One Shot");
    expect(store.getState().doc.actions![0].name).toBe("One Shot");

    const restored = IO.deserializeDocument(IO.serializeDocument(store.getState().doc, true));
    expect(restored.actions?.[0]).toMatchObject({
      id,
      name: "One Shot",
      steps: [
        { command: "duplicate", enabled: false },
        { command: "bring-to-front" },
      ],
    });

    action = store.getState().doc.actions![0];
    commands.deleteActionStep(store, id, action.steps[0].id);
    expect(store.getState().doc.actions![0].steps.map((step) => step.command)).toEqual(["bring-to-front"]);

    store.undo();
    expect(store.getState().doc.actions![0].steps.map((step) => step.command)).toEqual(["duplicate", "bring-to-front"]);
  });

  it("plays an action against the current selection as one undoable transaction", () => {
    const { store, back } = setup();
    const id = commands.newAction(store, "Duplicate Selection")!;

    store.replaceDoc(store.getState().doc, { markClean: true });
    store.setSelection([back.id]);
    commands.playAction(store, id);

    const state = store.getState();
    expect(state.doc.layers[0].items).toHaveLength(3);
    expect(state.selection).toHaveLength(1);
    expect(state.selection[0]).not.toBe(back.id);
    expect(Query.getItem(state.doc, state.selection[0])).toBeTruthy();

    store.undo();
    expect(store.getState().doc.layers[0].items).toHaveLength(2);
    expect(store.getState().selection).toEqual([back.id]);
  });

  it("keeps disabled playback steps from mutating artwork", () => {
    const { store, front } = setup();
    const id = commands.newAction(store, "Guarded Delete")!;
    commands.deleteActionStep(store, id, store.getState().doc.actions![0].steps[0].id);
    commands.appendActionStep(store, id, "delete");
    const stepId = store.getState().doc.actions![0].steps[0].id;
    commands.setActionStepEnabled(store, id, stepId, false);

    store.replaceDoc(store.getState().doc, { markClean: true });
    store.setSelection([front.id]);
    commands.playAction(store, actionId(store));

    expect(store.getState().doc.layers[0].items).toHaveLength(2);
    expect(store.getState().selection).toEqual([front.id]);
    expect(store.getState().dirty).toBe(false);
  });
});
