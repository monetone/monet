// ─────────────────────────────────────────────────────────────
// commands-transform-again.test — Object ▸ Transform ▸ Transform Again
// ─────────────────────────────────────────────────────────────
// commands.transformAgain re-applies the last transform (rotate / reflect /
// Transform Each) to the current selection — Illustrator's step-and-repeat.

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, makeDocument, makePath, makeAnchor as anchor, Query } from "./engine";

// A non-square rectangle path (120 × 60) at (100,100) — so a 90° rotation visibly
// swaps the bounds (60 × 120) and Transform Again swaps them back.
const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const p = makePath({
    closed: true,
    anchors: [anchor({ x: 100, y: 100 }), anchor({ x: 220, y: 100 }), anchor({ x: 220, y: 160 }), anchor({ x: 100, y: 160 })],
  });
  doc.layers[0].items.push(p);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([p.id]);
  return { store, p };
};
const bounds = (store: ArtisanStore, id: string) => Query.selectionBounds(store.getState().doc, [id])!;
// The transform-affected shape (geometry + transform), excluding identity fields
// like id/name so two independently-created paths can be compared.
const shape = (store: ArtisanStore, id: string) => {
  const it = Query.getItem(store.getState().doc, id)!;
  return { transform: it.transform, geometry: it.type === "path" ? it.geometry : null };
};

describe("commands.transformAgain — recording", () => {
  it("records the matching TransformOp for each transform", () => {
    for (const [run, expected] of [
      [(s: ArtisanStore) => commands.rotate90CW(s), { kind: "rotate90cw" }],
      [(s: ArtisanStore) => commands.rotate90CCW(s), { kind: "rotate90ccw" }],
      [(s: ArtisanStore) => commands.reflectHorizontal(s), { kind: "reflect-h" }],
      [(s: ArtisanStore) => commands.reflectVertical(s), { kind: "reflect-v" }],
    ] as const) {
      const { store } = setup();
      run(store);
      expect(store.getState().lastTransform).toEqual(expected);
    }
  });

  it("records Transform Each with its opts", () => {
    const { store } = setup();
    commands.transformEach(store, { scaleX: 0.5, scaleY: 0.5 });
    expect(store.getState().lastTransform).toEqual({ kind: "transform-each", opts: { scaleX: 0.5, scaleY: 0.5 } });
  });

  it("does NOT record when nothing is selected (no transform ran)", () => {
    const { store } = setup();
    commands.rotate90CW(store); // records rotate90cw
    store.clearSelection();
    commands.reflectHorizontal(store); // no selection ⇒ no transform ⇒ no record
    expect(store.getState().lastTransform).toEqual({ kind: "rotate90cw" }); // unchanged
  });
});

describe("commands.transformAgain — repeat", () => {
  it("is a no-op with no recorded transform (no undo entry)", () => {
    const { store } = setup();
    const before = store.canUndo;
    commands.transformAgain(store);
    expect(store.canUndo).toBe(before);
  });

  it("repeats a 90° rotation: bounds swap, then swap back to the original", () => {
    const { store, p } = setup();
    expect(bounds(store, p.id).width).toBeCloseTo(120, 6);
    commands.rotate90CW(store);
    expect(bounds(store, p.id).width).toBeCloseTo(60, 6); // 120×60 → 60×120
    commands.transformAgain(store);
    const b = bounds(store, p.id);
    expect(b.width).toBeCloseTo(120, 6); // 180° total ⇒ back to 120×60
    expect(b.height).toBeCloseTo(60, 6);
  });

  it("repeats Transform Each with the same opts (0.5 × 0.5 ⇒ 0.25× bounds)", () => {
    const { store, p } = setup();
    commands.transformEach(store, { scaleX: 0.5, scaleY: 0.5 });
    expect(bounds(store, p.id).width).toBeCloseTo(60, 6);
    commands.transformAgain(store);
    expect(bounds(store, p.id).width).toBeCloseTo(30, 6); // quarter of the original 120
  });

  it("repeating a reflect is exactly equivalent to invoking it again", () => {
    const a = setup();
    commands.reflectHorizontal(a.store);
    commands.transformAgain(a.store); // reflect via Transform Again
    const ctrl = setup();
    commands.reflectHorizontal(ctrl.store);
    commands.reflectHorizontal(ctrl.store); // reflect directly, twice
    expect(shape(a.store, a.p.id)).toEqual(shape(ctrl.store, ctrl.p.id));
  });

  it("is undoable", () => {
    const { store, p } = setup();
    commands.rotate90CW(store);
    const swapped = bounds(store, p.id).width; // 60
    commands.transformAgain(store); // back to 120
    store.undo();
    expect(bounds(store, p.id).width).toBeCloseTo(swapped, 6); // undo restores the single-rotation state
  });
});
