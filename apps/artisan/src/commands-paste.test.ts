// ─────────────────────────────────────────────────────────────
// commands-paste.test — plain Paste (⌘V) centres in the view (parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator — ⌘V pastes the clipboard at the CENTRE of the
// current view of the artboard (unlike Paste in Front/Back which keep position).
// This is an integration test: a real ArtisanStore driven through commands.

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, makeDocument, makeRect, Query } from "./engine";

const stamp = (view: { zoom: number; tx: number; ty: number }, viewport: { width: number; height: number }) => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const rect = makeRect(0, 0, 40, 20); // bbox centre (20,10) — far from the view centre
  doc.layers[0].items.push(rect);
  store.replaceDoc(doc, { markClean: true });
  store.setViewport(viewport);
  store.setView({ ...view, angle: 0 });
  store.setSelection([rect.id]);
  commands.copy(store);
  commands.paste(store);
  const pastedId = store.getState().selection[0];
  const b = Query.worldBounds(store.getState().doc, pastedId)!;
  return { store, pastedId, origId: rect.id, center: [b.x + b.width / 2, b.y + b.height / 2] as [number, number] };
};

describe("commands.paste — centre on view", () => {
  it("pastes centred on the view (zoom 1, no pan → viewport centre)", () => {
    const { center } = stamp({ zoom: 1, tx: 0, ty: 0 }, { width: 800, height: 600 });
    expect(center).toEqual([400, 300]); // (800/2, 600/2)
  });

  it("accounts for pan and zoom", () => {
    // world centre = (viewport/2 - t) / zoom = ((400-100)/2, (300-100)/2) = (150,100)
    const { center } = stamp({ zoom: 2, tx: 100, ty: 100 }, { width: 800, height: 600 });
    expect(center).toEqual([150, 100]);
  });

  it("creates a real copy (fresh id) — not a move of the original", () => {
    const { store, pastedId, origId } = stamp({ zoom: 1, tx: 0, ty: 0 }, { width: 800, height: 600 });
    expect(pastedId).not.toBe(origId);
    expect(store.getState().doc.layers[0].items.length).toBe(2);
    // the original stays put at its own bbox centre (20,10)
    const ob = Query.worldBounds(store.getState().doc, origId)!;
    expect([ob.x + ob.width / 2, ob.y + ob.height / 2]).toEqual([20, 10]);
  });
});
