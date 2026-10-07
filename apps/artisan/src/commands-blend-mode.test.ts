// ─────────────────────────────────────────────────────────────
// commands-blend-mode.test — Blend Mode command (parity)
// ─────────────────────────────────────────────────────────────
// Integration: setting a blend mode applies to the selection in one undoable
// transaction (Adobe Illustrator Transparency panel).

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, makeDocument, makeRect, Query, solid, rgba } from "./engine";

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const r = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(rgba(220, 0, 0)) });
  doc.layers[0].items.push(r);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([r.id]);
  return { store, r };
};
const blendOf = (store: ArtisanStore, id: string) => Query.getItem(store.getState().doc, id)!.blendMode;

describe("commands.setBlendMode", () => {
  it("applies the blend mode to the selection, undoable", () => {
    const { store, r } = setup();
    commands.setBlendMode(store, "multiply");
    expect(blendOf(store, r.id)).toBe("multiply");
    store.undo();
    expect(blendOf(store, r.id)).toBe("normal"); // back to the default
  });

  it("no-op when nothing is selected", () => {
    const { store } = setup();
    store.clearSelection();
    const before = store.canUndo;
    commands.setBlendMode(store, "screen");
    expect(store.canUndo).toBe(before);
  });
});
