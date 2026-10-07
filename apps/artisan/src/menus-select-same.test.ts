// ─────────────────────────────────────────────────────────────
// menus-select-same.test — Select ▸ Same menu wiring (smoke)
// ─────────────────────────────────────────────────────────────
// Smoke: Select ▸ Same ▸ {Blending Mode, Fill & Stroke} exist, gate on a
// selection, and their actions extend the selection to matching objects
// (menu → command → Query.selectSame → store selection).

import { describe, it, expect } from "vitest";
import { buildMenus } from "./ui/menus";
import { ArtisanStore, makeDocument, makeRect, makeText, solid, defaultStroke, rgba } from "./engine";
import type { MenuItemDef } from "@monet-ui/monet-react";

type Entry = { id?: string; label?: string; disabled?: boolean; action?: () => void; items?: MenuItemDef[] };

const findById = (entries: Entry[], id: string): Entry | null => {
  for (const e of entries) {
    if (e.id === id) return e;
    if (e.items) {
      const f = findById(e.items as Entry[], id);
      if (f) return f;
    }
  }
  return null;
};

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const a = makeRect(0, 0, 10, 10, 0, 0, { fill: solid(rgba(220, 0, 0)) });
  const b = makeRect(20, 0, 10, 10, 0, 0, { fill: solid(rgba(0, 0, 220)) });
  a.blendMode = "multiply";
  b.blendMode = "multiply";
  const c = makeRect(40, 0, 10, 10, 0, 0, { fill: solid(rgba(0, 220, 0)) }); // normal
  for (const r of [a, b, c]) doc.layers[0].items.push(r);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([a.id]);
  return { store, a, b, c };
};
const itemById = (store: ArtisanStore, id: string) => findById(buildMenus(store, store.getState()) as unknown as Entry[], id);

describe("menus — Select ▸ Same (blend mode / fill & stroke)", () => {
  it("exposes Blending Mode and Fill & Stroke, enabled with a selection", () => {
    const { store } = setup();
    for (const [id, label] of [["same-blend-mode", "Blending Mode"], ["same-fill-stroke", "Fill & Stroke"]] as const) {
      const it = itemById(store, id);
      expect(it).toBeTruthy();
      expect(it!.label).toBe(label);
      expect(it!.disabled).toBeFalsy();
    }
  });

  it("disables the items with an empty selection", () => {
    const { store } = setup();
    store.clearSelection();
    expect(itemById(store, "same-blend-mode")!.disabled).toBe(true);
  });

  it("running Blending Mode selects every object sharing the blend mode", () => {
    const { store, a, b, c } = setup();
    itemById(store, "same-blend-mode")!.action!();
    expect(new Set(store.getState().selection)).toEqual(new Set([a.id, b.id])); // both multiply; c excluded
    expect(store.getState().selection).not.toContain(c.id);
  });

  it("Fill & Stroke matches fill+stroke+weight together", () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    const a = makeRect(0, 0, 10, 10, 0, 0, { fill: solid(rgba(220, 0, 0)), stroke: { ...defaultStroke(solid(rgba(0, 0, 0))), width: 2 } });
    const b = makeRect(20, 0, 10, 10, 0, 0, { fill: solid(rgba(220, 0, 0)), stroke: { ...defaultStroke(solid(rgba(0, 0, 0))), width: 2 } });
    const c = makeRect(40, 0, 10, 10, 0, 0, { fill: solid(rgba(220, 0, 0)), stroke: { ...defaultStroke(solid(rgba(0, 0, 0))), width: 5 } }); // different weight
    for (const r of [a, b, c]) doc.layers[0].items.push(r);
    store.replaceDoc(doc, { markClean: true });
    store.setSelection([a.id]);
    itemById(store, "same-fill-stroke")!.action!();
    expect(new Set(store.getState().selection)).toEqual(new Set([a.id, b.id]));
  });
});

describe("menus — Select ▸ Same (font family / size)", () => {
  const setupFont = () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    const tA = makeText("a", 0, 0, { fontFamily: "Helvetica", fontSize: 24 });
    const tB = makeText("b", 0, 30, { fontFamily: "Helvetica", fontSize: 48 });
    const tC = makeText("c", 0, 60, { fontFamily: "Times", fontSize: 24 });
    const r = makeRect(0, 90, 10, 10, 0, 0, { fill: solid(rgba(220, 0, 0)) });
    for (const it of [tA, tB, tC, r]) doc.layers[0].items.push(it);
    store.replaceDoc(doc, { markClean: true });
    return { store, tA, tB, tC, r };
  };

  it("gates Font Family / Font Size on a text selection", () => {
    const { store, tA, r } = setupFont();
    store.setSelection([r.id]); // non-text → disabled
    expect(itemById(store, "same-font-family")!.disabled).toBe(true);
    expect(itemById(store, "same-font-size")!.disabled).toBe(true);
    store.setSelection([tA.id]);
    expect(itemById(store, "same-font-family")!.disabled).toBeFalsy();
    expect(itemById(store, "same-font-size")!.disabled).toBeFalsy();
  });

  it("Font Family selects all text in the same family", () => {
    const { store, tA, tB } = setupFont();
    store.setSelection([tA.id]);
    itemById(store, "same-font-family")!.action!();
    expect(new Set(store.getState().selection)).toEqual(new Set([tA.id, tB.id]));
  });

  it("Font Size keys off the first selected text even when a non-text is first", () => {
    const { store, tA, tC, r } = setupFont();
    store.setSelection([r.id, tA.id]); // rect is ids[0]; reference-picking uses tA
    itemById(store, "same-font-size")!.action!();
    expect(new Set(store.getState().selection)).toEqual(new Set([tA.id, tC.id])); // both size 24
  });

  it("gates Font Family & Style / Text Fill Color on a text selection", () => {
    const { store, tA, r } = setupFont();
    store.setSelection([r.id]); // non-text → disabled
    expect(itemById(store, "same-font-style")!.disabled).toBe(true);
    expect(itemById(store, "same-text-fill")!.disabled).toBe(true);
    store.setSelection([tA.id]);
    expect(itemById(store, "same-font-style")!.disabled).toBeFalsy();
    expect(itemById(store, "same-text-fill")!.disabled).toBeFalsy();
  });

  it("Text Fill Color selects text by fill, excluding a same-coloured non-text", () => {
    const { store, tA, tB, tC, r } = setupFont(); // all texts default to black fill; rect is red
    store.setSelection([tA.id]);
    itemById(store, "same-text-fill")!.action!();
    const sel = new Set(store.getState().selection);
    expect(sel).toEqual(new Set([tA.id, tB.id, tC.id])); // every (black) text object
    expect(sel.has(r.id)).toBe(false); // the rect is excluded (non-text)
  });
});
