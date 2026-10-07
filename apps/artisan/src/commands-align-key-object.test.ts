// ─────────────────────────────────────────────────────────────
// commands-align-key-object.test — Align panel "Align To ▸ Key Object"
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Align panel "Align To: Key Object". Designate one
// of the selected objects as the KEY; every align/distribute then measures
// against the key's bounds, so the key stays put and the others snap to it.
// Making a brand-new selection drops the key. Here we drive a real ArtisanStore
// through commands.align(store, action, "key-object") and assert the geometry,
// plus the store-level key-object lifecycle the Selection tool relies on.

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, makeDocument, makeRect, solid, rgba, Query } from "./engine";
import type { Rect } from "./engine";

const wb = (store: ArtisanStore, id: string): Rect => Query.worldBounds(store.getState().doc, id)!;

// A=(0,0,40,20)  B=(200,120,20,80)  C=(120,300,80,40) — distinct positions+sizes.
const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const A = makeRect(0, 0, 40, 20, 0, 0, { fill: solid(rgba(220, 90, 90)) });
  const B = makeRect(200, 120, 20, 80, 0, 0, { fill: solid(rgba(90, 140, 220)) });
  const C = makeRect(120, 300, 80, 40, 0, 0, { fill: solid(rgba(120, 200, 120)) });
  doc.layers[0].items.push(A, B, C);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([A.id, B.id, C.id]);
  return { store, A: A.id, B: B.id, C: C.id };
};

describe("commands.align — Align to Key Object", () => {
  it("aligns every object to the key's LEFT edge; the key object does not move", () => {
    const { store, A, B, C } = setup();
    const keyBefore = wb(store, B);
    store.setKeyObject(B);
    commands.align(store, "left", "key-object");
    expect(wb(store, A).x).toBe(200); // A's left → key's left (200)
    expect(wb(store, C).x).toBe(200); // C's left → key's left (200)
    expect(wb(store, B)).toEqual(keyBefore); // key unchanged
  });

  it("aligns to the key's TOP edge; the key stays put", () => {
    const { store, A, B, C } = setup();
    const keyBefore = wb(store, B);
    store.setKeyObject(B);
    commands.align(store, "top", "key-object");
    expect(wb(store, A).y).toBe(120);
    expect(wb(store, C).y).toBe(120);
    expect(wb(store, B)).toEqual(keyBefore);
  });

  it("center-h aligns each object's centre to the key's centre", () => {
    const { store, A, B } = setup();
    store.setKeyObject(B);
    const keyCx = wb(store, B).x + wb(store, B).width / 2; // 210
    commands.align(store, "center-h", "key-object");
    expect(wb(store, A).x + wb(store, A).width / 2).toBe(keyCx);
  });

  it("falls back to the SELECTION bounds when no key is set (no crash)", () => {
    const { store, A, B, C } = setup();
    // relativeTo "key-object" but keyObjectId is null → selection-bounds behaviour.
    commands.align(store, "left", "key-object");
    // selection-bounds left = min(0,200,120) = 0 → every left edge collapses to 0.
    expect(wb(store, A).x).toBe(0);
    expect(wb(store, B).x).toBe(0);
    expect(wb(store, C).x).toBe(0);
  });

  it("falls back to selection bounds when the key is not part of the selection", () => {
    const { store, A, B } = setup();
    store.setKeyObject("not-selected"); // stale / foreign id
    commands.align(store, "left", "key-object");
    expect(wb(store, A).x).toBe(0); // selection-bounds, not key
    expect(wb(store, B).x).toBe(0);
  });

  it("is one undoable transaction (key alignment restores on undo)", () => {
    const { store, A, B } = setup();
    store.setKeyObject(B);
    commands.align(store, "left", "key-object");
    expect(wb(store, A).x).toBe(200);
    store.undo();
    expect(wb(store, A).x).toBe(0); // restored
  });
});

describe("store — key-object lifecycle", () => {
  it("defaults to null and setKeyObject sets it", () => {
    const { store, B } = setup();
    expect(store.keyObjectId).toBeNull();
    store.setKeyObject(B);
    expect(store.keyObjectId).toBe(B);
  });

  it("a brand-new setSelection drops the key", () => {
    const { store, A, B } = setup();
    store.setKeyObject(B);
    store.setSelection([A]);
    expect(store.keyObjectId).toBeNull();
  });

  it("clearSelection and selectAll drop the key", () => {
    const { store, B } = setup();
    store.setKeyObject(B);
    store.clearSelection();
    expect(store.keyObjectId).toBeNull();
    store.setSelection([B]);
    store.setKeyObject(B);
    store.selectAll();
    expect(store.keyObjectId).toBeNull();
  });

  it("toggling OFF the key clears it; toggling another item keeps it", () => {
    const { store, A, B, C } = setup();
    store.setKeyObject(B);
    store.toggleSelection(A); // remove A (not the key) → key survives
    expect(store.keyObjectId).toBe(B);
    store.toggleSelection(C); // remove C (not the key) → key survives
    expect(store.keyObjectId).toBe(B);
    store.toggleSelection(B); // remove the key itself → cleared
    expect(store.keyObjectId).toBeNull();
  });
});
