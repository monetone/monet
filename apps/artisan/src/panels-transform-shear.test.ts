// ─────────────────────────────────────────────────────────────
// panels-transform-shear.test — Properties/Transform panel Shear (▱) field
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Transform panel "Shear" field — for a single
// object it shows the object's horizontal skew and sets it ABSOLUTELY about the
// object's centre; a multi-selection shears by the entered amount each commit.
// Shear composes additively in tan-space (shearing uses tan θ), so the absolute
// set uses delta = atan(tan target − tan current). (Drives a real store exactly
// as the panel's setShear handler, the same convention as panels-transform-rotate.)

import { describe, it, expect } from "vitest";
import { ArtisanStore, makeDocument, makeRect, Query, Ops, Mat, solid, rgba } from "./engine";

const sel = (store: ArtisanStore) => store.getState().selection;
const bounds = (store: ArtisanStore) => Query.selectionBounds(store.getState().doc, sel(store))!;
const single = (store: ArtisanStore) => (sel(store).length === 1 ? Query.getItem(store.getState().doc, sel(store)[0]) : null);
const itemShearDeg = (store: ArtisanStore, id: string) => (Mat.decompose(Query.getItem(store.getState().doc, id)!.transform).skewX * 180) / Math.PI;

// the panel's display value + handler, verbatim
const shearOf = (store: ArtisanStore) => {
  const s = single(store);
  return s ? (Mat.decompose(s.transform).skewX * 180) / Math.PI : 0;
};
const setShear = (store: ArtisanStore, deg: number) => {
  const b = bounds(store);
  if (!b) return;
  const target = (Math.max(-89, Math.min(89, deg)) * Math.PI) / 180;
  const pivot = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  const s = single(store);
  const current = s ? Mat.decompose(s.transform).skewX : 0;
  const delta = Math.atan(Math.tan(target) - Math.tan(current));
  if (Math.abs(delta) < 1e-9) return;
  store.transact("Shear", (d) => Ops.Transform.shearItems(d, sel(store), delta, 0, pivot));
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

describe("Transform panel — Shear (▱) field", () => {
  it("sets a single object's shear absolutely and widens its bounding box", () => {
    const { store } = setup({ x: 100, y: 100, w: 80, h: 60 });
    setShear(store, 30);
    expect(shearOf(store)).toBeCloseTo(30, 4);
    expect(bounds(store).width).toBeGreaterThan(81); // skew widens the AABB
  });

  it("is absolute, not cumulative: 30° then 50° lands at 50° (tan-space delta)", () => {
    const { store } = setup({ x: 100, y: 100, w: 80, h: 60 });
    setShear(store, 30);
    setShear(store, 50);
    expect(shearOf(store)).toBeCloseTo(50, 4); // not the additive-angle 43.3°
  });

  it("returning to 0° restores the upright bounds, and each commit is one undo step", () => {
    const { store } = setup({ x: 100, y: 100, w: 80, h: 60 });
    setShear(store, 30);
    setShear(store, 0);
    expect(shearOf(store)).toBeCloseTo(0, 4);
    expect(bounds(store).width).toBeCloseTo(80, 4); // upright again
    store.undo(); // undo the →0 commit
    expect(shearOf(store)).toBeCloseTo(30, 4);
  });

  it("re-entering the same angle is a no-op (no extra undo entry)", () => {
    const { store } = setup({ x: 100, y: 100, w: 80, h: 60 });
    setShear(store, 25);
    const undos = store.canUndo;
    setShear(store, 25); // delta ≈ 0
    expect(store.canUndo).toBe(undos);
    expect(shearOf(store)).toBeCloseTo(25, 4);
  });

  it("shears a multi-selection by the entered amount about its shared centre", () => {
    const { store, ids } = setup({ x: 0, y: 0, w: 40, h: 40 }, { x: 100, y: 0, w: 40, h: 40 });
    expect(shearOf(store)).toBe(0); // no shared skew shown for a multi-selection
    setShear(store, 20);
    expect(itemShearDeg(store, ids[0])).toBeCloseTo(20, 4); // both items skewed
    expect(itemShearDeg(store, ids[1])).toBeCloseTo(20, 4);
    expect(shearOf(store)).toBe(0); // field still shows 0 (delta-based for multi)
  });

  it("DISPLAYS an already-sheared object's angle with no fresh commit", () => {
    const { store, ids } = setup({ x: 100, y: 100, w: 80, h: 60 });
    const b = bounds(store);
    store.transact("seed", (d) => Ops.Transform.shearItems(d, ids, (40 * Math.PI) / 180, 0, { x: b.x + b.width / 2, y: b.y + b.height / 2 }));
    expect(shearOf(store)).toBeCloseTo(40, 4); // field reflects the existing skew
    const undos = store.canUndo;
    setShear(store, 40); // already at 40 ⇒ no-op
    expect(store.canUndo).toBe(undos);
  });

  it("is undoable", () => {
    const { store } = setup({ x: 100, y: 100, w: 80, h: 60 });
    setShear(store, 30);
    expect(shearOf(store)).toBeCloseTo(30, 4);
    store.undo();
    expect(shearOf(store)).toBeCloseTo(0, 4);
  });
});
