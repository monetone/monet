// ─────────────────────────────────────────────────────────────
// commands-pattern.test — Object ▸ Pattern ▸ Make (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator "Object ▸ Pattern ▸ Make" turns the selected art
// into a reusable PATTERN SWATCH (added to the Swatches panel) that tiles by the
// art's bounding box, and leaves it ready to apply. Our command clones the
// selection, bakes each item's world transform relative to the selection's bbox
// origin (so the tile lives in 0,0→(w,h) space), pushes the pattern paint to
// `doc.swatches`, and sets it as the active fill. One undoable step.

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, makeDocument, makeRect, solid, rgba, type Document, type Paint } from "./engine";

const RED = solid(rgba(200, 80, 80));

const setup = (build: (d: Document) => void) => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  build(doc);
  store.replaceDoc(doc, { markClean: true });
  return store;
};
const lastSwatch = (store: ArtisanStore): Paint => {
  const sw = store.getState().doc.swatches;
  return sw[sw.length - 1];
};

describe("Make Pattern command", () => {
  it("creates a pattern swatch from the selection + makes it the active fill", () => {
    const rect = makeRect(100, 100, 50, 50, 0, 0, { fill: RED });
    const store = setup((d) => d.layers[0].items.push(rect));
    store.setSelection([rect.id]);
    const before = store.getState().doc.swatches.length;

    commands.makePattern(store);

    expect(store.getState().doc.swatches).toHaveLength(before + 1);
    const p = lastSwatch(store);
    expect(p.type).toBe("pattern");
    if (p.type !== "pattern") throw new Error("expected a pattern swatch");
    expect(p.pattern.tile).toHaveLength(1);
    // tiles by the selection's bounding box (50×50)
    expect(p.pattern.width).toBe(50);
    expect(p.pattern.height).toBe(50);
    // ready to apply: the active fill is the pattern
    expect(store.getState().fill.type).toBe("pattern");
  });

  it("bakes each tile item relative to the selection bbox origin (tile space starts at 0,0)", () => {
    const rect = makeRect(100, 100, 50, 50, 0, 0, { fill: RED });
    const store = setup((d) => d.layers[0].items.push(rect));
    store.setSelection([rect.id]);
    commands.makePattern(store);

    const p = lastSwatch(store);
    if (p.type !== "pattern") throw new Error("expected a pattern swatch");
    // rect lives at world (100,100); bbox origin (100,100) → shifted to tile (0,0)
    expect(p.pattern.tile[0].transform.e).toBe(0);
    expect(p.pattern.tile[0].transform.f).toBe(0);
  });

  it("a multi-selection tiles by the COMBINED bounds", () => {
    const a = makeRect(100, 100, 40, 40, 0, 0, { fill: RED });
    const b = makeRect(200, 160, 40, 40, 0, 0, { fill: RED }); // union: x100..240, y100..200
    const store = setup((d) => d.layers[0].items.push(a, b));
    store.setSelection([a.id, b.id]);
    commands.makePattern(store);

    const p = lastSwatch(store);
    if (p.type !== "pattern") throw new Error("expected a pattern swatch");
    expect(p.pattern.tile).toHaveLength(2);
    expect(p.pattern.width).toBe(140);
    expect(p.pattern.height).toBe(100);
  });

  it("is one undoable step (undo removes the swatch) and a no-op without a selection", () => {
    const rect = makeRect(100, 100, 50, 50, 0, 0, { fill: RED });
    const store = setup((d) => d.layers[0].items.push(rect));
    store.setSelection([rect.id]);
    const base = store.getState().doc.swatches.length;

    commands.makePattern(store);
    expect(store.getState().doc.swatches).toHaveLength(base + 1);
    store.undo();
    expect(store.getState().doc.swatches).toHaveLength(base); // swatch removed in one step

    // empty selection → no swatch added
    store.setSelection([]);
    commands.makePattern(store);
    expect(store.getState().doc.swatches).toHaveLength(base);
  });
});
