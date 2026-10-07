// ─────────────────────────────────────────────────────────────
// commands-drawing-mode.test — Draw Normal / Behind / Inside mode toggle
// ─────────────────────────────────────────────────────────────
// The toolbar drawing-mode cluster sets a VIEW flag (store merge, not a document
// edit), so it never creates an undo entry. Draw Inside also captures the single
// selected object as the clip target.

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, makeDocument, makeRect, solid, rgba } from "./engine";

const setup = () => {
  const store = new ArtisanStore();
  store.replaceDoc(makeDocument(), { markClean: true });
  return store;
};

const setupWithRects = (n: number) => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const ids = Array.from({ length: n }, (_, i) => {
    const r = makeRect(i * 40, 0, 30, 30, 0, 0, { fill: solid(rgba(200, 100, 100)) });
    doc.layers[0].items.push(r);
    return r.id;
  });
  store.replaceDoc(doc, { markClean: true });
  return { store, ids };
};

describe("commands.setDrawingMode / cycleDrawingMode", () => {
  it("defaults to normal and sets the mode without adding an undo entry", () => {
    const store = setup();
    expect(store.getState().drawingMode).toBe("normal");
    const undos = store.canUndo;
    commands.setDrawingMode(store, "behind");
    expect(store.getState().drawingMode).toBe("behind");
    expect(store.canUndo).toBe(undos); // a view flag, not a document mutation
  });

  it("cycles normal → behind → inside → normal", () => {
    const store = setup();
    commands.cycleDrawingMode(store);
    expect(store.getState().drawingMode).toBe("behind");
    commands.cycleDrawingMode(store);
    expect(store.getState().drawingMode).toBe("inside");
    commands.cycleDrawingMode(store);
    expect(store.getState().drawingMode).toBe("normal");
  });

  it("Draw Inside captures the single selected object as the clip target", () => {
    const { store, ids } = setupWithRects(1);
    store.setSelection([ids[0]]);
    commands.setDrawingMode(store, "inside");
    expect(store.getState().drawInsideTarget).toBe(ids[0]);
  });

  it("captures no target when the selection is not exactly one object", () => {
    const { store, ids } = setupWithRects(2);
    store.setSelection(ids); // two selected
    commands.setDrawingMode(store, "inside");
    expect(store.getState().drawInsideTarget).toBeNull();
  });

  it("clears the target when leaving Draw Inside", () => {
    const { store, ids } = setupWithRects(1);
    store.setSelection([ids[0]]);
    commands.setDrawingMode(store, "inside");
    expect(store.getState().drawInsideTarget).toBe(ids[0]);
    commands.setDrawingMode(store, "normal");
    expect(store.getState().drawInsideTarget).toBeNull();
  });
});
