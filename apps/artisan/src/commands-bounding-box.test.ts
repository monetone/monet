// ─────────────────────────────────────────────────────────────
// commands-bounding-box.test — View ▸ Hide/Show Bounding Box (parity)
// ─────────────────────────────────────────────────────────────
// Integration: commands.toggleBoundingBox flips the showBoundingBox view flag
// (shown by default) without creating an undo entry.

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, makeDocument } from "./engine";

const setup = () => {
  const store = new ArtisanStore();
  store.replaceDoc(makeDocument(), { markClean: true });
  return store;
};

describe("commands.toggleBoundingBox", () => {
  it("is shown by default and toggles off/on", () => {
    const store = setup();
    expect(store.getState().showBoundingBox).toBe(true);
    commands.toggleBoundingBox(store);
    expect(store.getState().showBoundingBox).toBe(false);
    commands.toggleBoundingBox(store);
    expect(store.getState().showBoundingBox).toBe(true);
  });

  it("is a view flag — no undo entry", () => {
    const store = setup();
    commands.toggleBoundingBox(store);
    expect(store.canUndo).toBe(false);
  });
});
