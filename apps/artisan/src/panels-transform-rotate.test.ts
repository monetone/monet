// ─────────────────────────────────────────────────────────────
// panels-transform-rotate.test — Properties/Transform panel Rotate (∠) field
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Transform panel "Rotate" field — for a single
// object it shows the object's rotation and sets it ABSOLUTELY about the object's
// centre; a multi-selection has no shared angle, so it rotates by the entered
// amount each commit. (Drives a real store exactly as the panel's setRotation
// handler, the same convention as panels-transform / panels-properties-shape.)

import { describe, it, expect } from "vitest";
import { ArtisanStore, makeDocument, makeRect, Query, Ops, Mat, solid, rgba } from "./engine";

const sel = (store: ArtisanStore) => store.getState().selection;
const bounds = (store: ArtisanStore) => Query.selectionBounds(store.getState().doc, sel(store))!;
const single = (store: ArtisanStore) => (sel(store).length === 1 ? Query.getItem(store.getState().doc, sel(store)[0]) : null);
const itemRotationDeg = (store: ArtisanStore, id: string) => (Mat.decompose(Query.getItem(store.getState().doc, id)!.transform).rotation * 180) / Math.PI;

// the panel's display value + handler, verbatim
const rotationOf = (store: ArtisanStore) => {
  const s = single(store);
  return s ? (Mat.decompose(s.transform).rotation * 180) / Math.PI : 0;
};
const setRotation = (store: ArtisanStore, deg: number) => {
  const b = bounds(store);
  if (!b) return;
  const pivot = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  const s = single(store);
  const current = s ? Mat.decompose(s.transform).rotation : 0;
  const want = (deg * Math.PI) / 180 - current;
  const delta = Math.atan2(Math.sin(want), Math.cos(want));
  if (Math.abs(delta) < 1e-9) return;
  store.transact("Rotate", (d) => Ops.Transform.rotateItems(d, sel(store), delta, pivot));
};

const setup = (...rects: { x: number; y: number; w: number; h: number }[]) => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const ids = rects.map((r) => {
    const it = makeRect(r.x, r.y, r.w, r.h, 0, 0, { fill: solid(rgba(220, 0, 0)) });
    doc.layers[0].items.push(it);
    return it.id;
  });
  store.replaceDoc(doc, { markClean: true });
  store.setSelection(ids);
  return { store, ids };
};

describe("Transform panel — Rotate (∠) field", () => {
  it("sets a single object's rotation absolutely and grows its bounding box", () => {
    const { store } = setup({ x: 100, y: 100, w: 80, h: 60 });
    setRotation(store, 30);
    expect(rotationOf(store)).toBeCloseTo(30, 4);
    expect(bounds(store).width).toBeGreaterThan(81); // AABB widened by the rotation
  });

  it("is absolute, not cumulative: 30° then 50° lands at 50°", () => {
    const { store } = setup({ x: 100, y: 100, w: 80, h: 60 });
    setRotation(store, 30);
    setRotation(store, 50);
    expect(rotationOf(store)).toBeCloseTo(50, 4); // not 80
  });

  it("returning to 0° restores the upright bounds, and each commit is one undo step", () => {
    const { store } = setup({ x: 100, y: 100, w: 80, h: 60 });
    setRotation(store, 30);
    setRotation(store, 0);
    expect(rotationOf(store)).toBeCloseTo(0, 4);
    expect(bounds(store).width).toBeCloseTo(80, 4); // upright again
    store.undo(); // undo the →0 commit
    expect(rotationOf(store)).toBeCloseTo(30, 4);
  });

  it("takes the shortest signed turn (270° ≡ −90°), no spurious full spins", () => {
    const { store } = setup({ x: 100, y: 100, w: 80, h: 60 });
    setRotation(store, 270);
    expect(rotationOf(store)).toBeCloseTo(-90, 4);
  });

  it("re-entering the same angle is a no-op (no extra undo entry)", () => {
    const { store } = setup({ x: 100, y: 100, w: 80, h: 60 });
    setRotation(store, 45);
    const undos = store.canUndo;
    setRotation(store, 45); // delta ≈ 0
    expect(store.canUndo).toBe(undos);
    expect(rotationOf(store)).toBeCloseTo(45, 4);
  });

  it("rotates a multi-selection by the entered amount about its shared centre", () => {
    const { store, ids } = setup({ x: 0, y: 0, w: 40, h: 40 }, { x: 100, y: 0, w: 40, h: 40 });
    expect(rotationOf(store)).toBe(0); // no shared angle shown for a multi-selection
    setRotation(store, 90);
    expect(itemRotationDeg(store, ids[0])).toBeCloseTo(90, 4); // both items turned
    expect(itemRotationDeg(store, ids[1])).toBeCloseTo(90, 4);
    expect(rotationOf(store)).toBe(0); // field still shows 0 (delta-based for multi)
  });

  it("DISPLAYS an already-rotated object's angle with no fresh commit", () => {
    const { store, ids } = setup({ x: 100, y: 100, w: 80, h: 60 });
    const b = bounds(store);
    // pre-rotate 60° directly (as if loaded/rotated earlier), then only READ.
    store.transact("seed", (d) => Ops.Transform.rotateItems(d, ids, (60 * Math.PI) / 180, { x: b.x + b.width / 2, y: b.y + b.height / 2 }));
    expect(rotationOf(store)).toBeCloseTo(60, 4); // the field reflects the existing angle
    const undos = store.canUndo;
    setRotation(store, 60); // already at 60 ⇒ no-op
    expect(store.canUndo).toBe(undos);
  });

  it("sets the angle on a non-uniformly scaled object, preserving the scale", () => {
    const { store, ids } = setup({ x: 100, y: 100, w: 80, h: 60 });
    const b = bounds(store);
    store.transact("seed", (d) => Ops.Transform.scaleItems(d, ids, 2, 1, { x: b.x, y: b.y })); // stretch ×2 wide
    setRotation(store, 30);
    expect(rotationOf(store)).toBeCloseTo(30, 4); // rotation read is independent of the scale
    expect(Mat.decompose(Query.getItem(store.getState().doc, ids[0])!.transform).scaleX).toBeCloseTo(2, 4); // scale kept
  });

  it("is undoable", () => {
    const { store } = setup({ x: 100, y: 100, w: 80, h: 60 });
    setRotation(store, 30);
    expect(rotationOf(store)).toBeCloseTo(30, 4);
    store.undo();
    expect(rotationOf(store)).toBeCloseTo(0, 4);
  });
});
