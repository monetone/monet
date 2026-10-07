// ─────────────────────────────────────────────────────────────
// commands-guides.test — ruler guides store + commands
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator ruler guides — drag from a ruler to drop a
// horizontal/vertical guide; View ▸ Guides ▸ Clear Guides / Hide Guides.

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, makeDocument } from "./engine";

const setup = () => {
  const store = new ArtisanStore();
  store.replaceDoc(makeDocument(), { markClean: true });
  return store;
};

describe("ruler guides", () => {
  it("addGuide appends horizontal/vertical guides with unique ids", () => {
    const store = setup();
    store.addGuide("h", 120);
    store.addGuide("v", 80);
    const g = store.getState().guides;
    expect(g).toHaveLength(2);
    expect(g[0]).toMatchObject({ orientation: "h", pos: 120 });
    expect(g[1]).toMatchObject({ orientation: "v", pos: 80 });
    expect(g[0].id).not.toBe(g[1].id);
  });

  it("Clear Guides removes them all", () => {
    const store = setup();
    store.addGuide("h", 10);
    store.addGuide("v", 20);
    commands.clearGuides(store);
    expect(store.getState().guides).toHaveLength(0);
  });

  it("Show/Hide Guides toggles showGuides (default on)", () => {
    const store = setup();
    expect(store.getState().showGuides).toBe(true);
    commands.toggleGuides(store);
    expect(store.getState().showGuides).toBe(false);
    commands.toggleGuides(store);
    expect(store.getState().showGuides).toBe(true);
  });
});
