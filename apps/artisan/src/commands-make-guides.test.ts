// ─────────────────────────────────────────────────────────────
// commands-make-guides.test — View ▸ Guides ▸ Make Guides (helper + command)
// ─────────────────────────────────────────────────────────────
// boundsToGuides → the 4 edge guides of a box; commands.makeGuides adds H/V guides
// at each selected object's bounding edges (deduped), Artisan's H/V-guide take on
// Illustrator's Make Guides.

import { describe, it, expect } from "vitest";
import { commands, boundsToGuides } from "./commands";
import { ArtisanStore, makeDocument, makeRect, solid, rgba } from "./engine";

const RED = solid(rgba(220, 0, 0));
const guideSet = (store: ArtisanStore) => new Set(store.getState().guides.map((g) => `${g.orientation}:${g.pos}`));
const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const r = makeRect(200, 150, 80, 60, 0, 0, { fill: RED }); // edges x: 200/280, y: 150/210
  doc.layers[0].items.push(r);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([r.id]);
  return { store, r };
};

describe("boundsToGuides", () => {
  it("returns the four edge guides of a box", () => {
    expect(boundsToGuides({ x: 10, y: 20, width: 30, height: 40 })).toEqual([
      { orientation: "v", pos: 10 },
      { orientation: "v", pos: 40 },
      { orientation: "h", pos: 20 },
      { orientation: "h", pos: 60 },
    ]);
  });

  it("collapses a zero-width / zero-height box to a single guide on that axis", () => {
    expect(boundsToGuides({ x: 5, y: 7, width: 0, height: 0 })).toEqual([
      { orientation: "v", pos: 5 },
      { orientation: "h", pos: 7 },
    ]);
  });
});

describe("commands.makeGuides", () => {
  it("adds the selected rect's four edge guides", () => {
    const { store } = setup();
    commands.makeGuides(store);
    expect(guideSet(store)).toEqual(new Set(["v:200", "v:280", "h:150", "h:210"]));
  });

  it("de-duplicates against an existing guide", () => {
    const { store } = setup();
    store.addGuide("v", 200); // already on the rect's left edge
    commands.makeGuides(store);
    expect(store.getState().guides.filter((g) => g.orientation === "v" && g.pos === 200).length).toBe(1);
    expect(guideSet(store)).toEqual(new Set(["v:200", "v:280", "h:150", "h:210"]));
  });

  it("makes guides from each selected object, deduping shared edges", () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    const a = makeRect(0, 0, 50, 50, 0, 0, { fill: RED }); // v:0/50, h:0/50
    const b = makeRect(50, 0, 50, 50, 0, 0, { fill: RED }); // v:50/100, h:0/50 (shares v:50, h:0/50)
    doc.layers[0].items.push(a, b);
    store.replaceDoc(doc, { markClean: true });
    store.setSelection([a.id, b.id]);
    commands.makeGuides(store);
    expect(guideSet(store)).toEqual(new Set(["v:0", "v:50", "v:100", "h:0", "h:50"]));
  });

  it("is a no-op with an empty selection", () => {
    const { store } = setup();
    store.clearSelection();
    commands.makeGuides(store);
    expect(store.getState().guides.length).toBe(0);
  });
});
