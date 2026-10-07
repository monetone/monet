// ─────────────────────────────────────────────────────────────
// tools/text-edit-undo.test — editing existing text is one undoable step
// ─────────────────────────────────────────────────────────────
// Two bugs met here. Selection's double-click opened the "Edit Text"
// transaction and THEN switched tool — and the tool switch runs canvas-view's
// leaked-transaction guard, which cancelled that very transaction, so the whole
// inline edit produced no undo entry. And `finish()` rolled the transaction back
// whenever the text was empty, which is right for a stray click that created an
// object but silently restored the content of one the user deliberately cleared.

import { describe, it, expect } from "vitest";
import { getTool } from "./registry";
import { ArtisanStore, makeDocument, makeText, Ops, Query, type TextItem } from "../engine";
import type { ToolContext, ToolPointer } from "./types";

const ctxOf = (store: ArtisanStore): ToolContext =>
  ({ store, state: store.getState(), worldToScreen: (p) => p, screenToWorld: (p) => p, requestRender: () => {}, zoom: 1, viewport: { width: 800, height: 600 } }) as ToolContext;
const ptr = (x: number, y: number, detail = 1): ToolPointer =>
  ({ world: { x, y }, rawWorld: { x, y }, screen: { x, y }, shift: false, alt: false, mod: false, button: 0, detail }) as ToolPointer;

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const t = makeText("Hello", 0, 0, { fontSize: 40 });
  doc.layers[0].items.push(t);
  store.replaceDoc(doc, { markClean: true });
  return { store, t };
};
const textOf = (store: ArtisanStore, id: string) => (Query.getItem(store.getState().doc, id) as TextItem | null)?.text;
const setText = (store: ArtisanStore, id: string, s: string) => store.mutate((d) => Ops.Text.setText(d, [id], s));

/** What the app does on double-click: selection hands over, then the tool switches. */
const enterEditByDoubleClick = (store: ArtisanStore, x: number, y: number) => {
  const ctx = ctxOf(store);
  getTool("selection").onDoubleClick!(ptr(x, y, 2), ctx);
  // canvas-view cancels any transaction left open across a tool switch.
  if (store.transactionBase !== null) store.cancelTransaction();
  getTool("type").onActivate!(ctx);
};

describe("editing existing text", () => {
  it("double-click → edit → tool switch is ONE undoable step", () => {
    const { store, t } = setup();
    enterEditByDoubleClick(store, 5, 5);
    expect(store.transactionBase, "the edit must run inside a transaction").not.toBeNull();

    setText(store, t.id, "Goodbye");
    getTool("type").onDeactivate!(ctxOf(store));

    expect(textOf(store, t.id)).toBe("Goodbye");
    expect(store.canUndo).toBe(true);
    store.undo();
    expect(textOf(store, t.id)).toBe("Hello");
  });

  it("clearing an existing text keeps it cleared, and is undoable", () => {
    const { store, t } = setup();
    enterEditByDoubleClick(store, 5, 5);
    setText(store, t.id, "");
    getTool("type").onDeactivate!(ctxOf(store));

    expect(textOf(store, t.id)).toBe("");
    store.undo();
    expect(textOf(store, t.id)).toBe("Hello");
  });

  it("a stray Type click that creates an empty object still leaves nothing behind", () => {
    const store = new ArtisanStore();
    store.replaceDoc(makeDocument(), { markClean: true });
    const tool = getTool("type");
    const ctx = ctxOf(store);

    tool.onPointerUp!(ptr(300, 300), ctx); // creates an empty text
    tool.onDeactivate!(ctx); // …and walks away without typing

    expect(store.getState().doc.layers[0].items).toHaveLength(0);
    expect(store.canUndo).toBe(false);
  });

  it("editing existing text with the Type tool is undoable too", () => {
    const { store, t } = setup();
    const tool = getTool("type");
    const ctx = ctxOf(store);

    tool.onPointerUp!(ptr(5, 5), ctx); // clicks the existing text
    setText(store, t.id, "Typed");
    tool.onDeactivate!(ctx);

    expect(textOf(store, t.id)).toBe("Typed");
    store.undo();
    expect(textOf(store, t.id)).toBe("Hello");
  });
});
