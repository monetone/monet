// ─────────────────────────────────────────────────────────────
// commands-reselect.test — Select ▸ Reselect (⌘6)
// ─────────────────────────────────────────────────────────────
// Reference: Illustrator's Reselect re-runs the LAST Select ▸ Same / Select ▸
// Object command against the current selection. The query is remembered in the
// editor state (so the menu greys out until one has been run).

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { buildMenus } from "./ui/menus";
import { ArtisanStore, makeDocument, makeRect, makeText, solid, rgba } from "./engine";
import type { MenuItemDef } from "@monet-ui/monet-react";

const RED = solid(rgba(220, 0, 0, 1));
const BLUE = solid(rgba(0, 0, 220, 1));

type Entry = { id?: string; disabled?: boolean; action?: () => void; items?: MenuItemDef[] };
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
const itemById = (store: ArtisanStore, id: string) => findById(buildMenus(store, store.getState()) as unknown as Entry[], id);

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const r1 = makeRect(0, 0, 10, 10, 0, 0, { fill: RED });
  const r2 = makeRect(20, 0, 10, 10, 0, 0, { fill: RED });
  const b1 = makeRect(40, 0, 10, 10, 0, 0, { fill: BLUE });
  const b2 = makeRect(60, 0, 10, 10, 0, 0, { fill: BLUE });
  doc.layers[0].items.push(r1, r2, b1, b2);
  store.replaceDoc(doc, { markClean: true });
  return { store, r1, r2, b1, b2 };
};
const selSet = (store: ArtisanStore) => new Set(store.getState().selection);

describe("commands.reselect", () => {
  it("re-runs the last Select Same query against the CURRENT selection", () => {
    const { store, r1, r2, b1, b2 } = setup();
    store.setSelection([r1.id]);
    commands.selectSame(store, "fill"); // selects both reds
    expect(selSet(store)).toEqual(new Set([r1.id, r2.id]));

    store.setSelection([b1.id]); // new basis: a blue
    commands.reselect(store); // re-applies Same Fill on blue
    expect(selSet(store)).toEqual(new Set([b1.id, b2.id]));
  });

  it("re-runs the last Select Object query", () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    const t = makeText("hi", 0, 0);
    const r = makeRect(40, 0, 10, 10, 0, 0, { fill: RED });
    doc.layers[0].items.push(t, r);
    store.replaceDoc(doc, { markClean: true });
    commands.selectObjects(store, "text"); // selects the text object
    expect(store.getState().selection).toEqual([t.id]);

    store.clearSelection();
    commands.reselect(store); // re-runs "select text objects"
    expect(store.getState().selection).toEqual([t.id]);
  });

  it("records the query in state and is a no-op until one has been run", () => {
    const { store, r1 } = setup();
    expect(store.getState().lastSelectQuery).toBeNull(); // fresh document
    store.setSelection([r1.id]);
    commands.reselect(store); // nothing remembered yet
    expect(store.getState().selection).toEqual([r1.id]); // unchanged

    commands.selectSame(store, "stroke-weight");
    expect(store.getState().lastSelectQuery).toEqual({ kind: "same", criterion: "stroke-weight" });
  });

  it("a new document clears the remembered query", () => {
    const { store, r1 } = setup();
    store.setSelection([r1.id]);
    commands.selectSame(store, "fill");
    expect(store.getState().lastSelectQuery).not.toBeNull();
    store.replaceDoc(makeDocument(), { markClean: true });
    expect(store.getState().lastSelectQuery).toBeNull();
  });

  it("preserves the remembered query across undo / redo", () => {
    const { store, r1 } = setup();
    store.setSelection([r1.id]);
    commands.selectSame(store, "fill");
    const q = store.getState().lastSelectQuery;
    expect(q).not.toBeNull();
    store.transact("edit", (d) => {
      d.layers[0].items[0].opacity = 0.5; // a real document edit ⇒ an undo entry
    });
    store.undo();
    expect(store.getState().lastSelectQuery).toEqual(q); // query survives undo
    store.redo();
    expect(store.getState().lastSelectQuery).toEqual(q); // and redo
  });

  it("a Same reselect with nothing selected is a clean no-op that keeps the query", () => {
    const { store, r1 } = setup();
    store.setSelection([r1.id]);
    commands.selectSame(store, "fill"); // records {same, fill}
    store.clearSelection();
    commands.reselect(store); // selectSame's no-selection guard fires
    expect(store.getState().selection).toEqual([]); // unchanged, no throw
    expect(store.getState().lastSelectQuery).toEqual({ kind: "same", criterion: "fill" }); // query preserved
  });

  it("never adds an undo entry (Reselect is a selection change, not a document edit)", () => {
    const { store, r1, b1 } = setup();
    store.setSelection([r1.id]);
    commands.selectSame(store, "fill");
    const undos = store.canUndo;
    store.setSelection([b1.id]);
    commands.reselect(store);
    expect(store.canUndo).toBe(undos);
  });

  it("selectObjects records its query directly in state", () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    doc.layers[0].items.push(makeText("hi", 0, 0));
    store.replaceDoc(doc, { markClean: true });
    commands.selectObjects(store, "text");
    expect(store.getState().lastSelectQuery).toEqual({ kind: "object", k: "text" });
  });
});

describe("menus — Select ▸ Reselect", () => {
  it("is disabled until a Select query runs, then enabled and functional", () => {
    const { store, r1, b1, b2 } = setup();
    expect(itemById(store, "reselect")!.disabled).toBe(true); // nothing run yet

    store.setSelection([r1.id]);
    commands.selectSame(store, "fill");
    expect(itemById(store, "reselect")!.disabled).toBeFalsy();

    store.setSelection([b1.id]);
    itemById(store, "reselect")!.action!();
    expect(selSet(store)).toEqual(new Set([b1.id, b2.id]));
  });
});
