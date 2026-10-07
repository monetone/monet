// ─────────────────────────────────────────────────────────────
// commands-transparency-grid.test — View ▸ Show Transparency Grid (parity)
// ─────────────────────────────────────────────────────────────
// Integration: commands.toggleTransparencyGrid flips the transparencyGrid view
// flag (off by default) without creating an undo entry.

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, makeDocument } from "./engine";

const setup = () => {
  const store = new ArtisanStore();
  store.replaceDoc(makeDocument(), { markClean: true });
  return store;
};

describe("commands.toggleTransparencyGrid", () => {
  it("is hidden by default and toggles on/off", () => {
    const store = setup();
    expect(store.getState().transparencyGrid).toBe(false);
    commands.toggleTransparencyGrid(store);
    expect(store.getState().transparencyGrid).toBe(true);
    commands.toggleTransparencyGrid(store);
    expect(store.getState().transparencyGrid).toBe(false);
  });

  it("is a view flag — no undo entry", () => {
    const store = setup();
    commands.toggleTransparencyGrid(store);
    expect(store.canUndo).toBe(false);
  });
});
