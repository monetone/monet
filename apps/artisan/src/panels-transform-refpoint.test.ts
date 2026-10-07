// ─────────────────────────────────────────────────────────────
// panels-transform-refpoint.test — Transform panel 9-point reference proxy
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Transform panel reference-point grid — X/Y report
// the chosen anchor of the selection bounds and W/H scale AROUND it. Drives a
// real store exactly as the panel's setX/setW/setH handlers (anchor = refAnchor),
// the same convention as panels-transform-shear.

import { describe, it, expect } from "vitest";
import { ArtisanStore, makeDocument, makeRect, Query, Ops, solid, rgba } from "./engine";
import { refAnchor, type RefPoint } from "./ui/transform-ref";

const bounds = (store: ArtisanStore) => Query.selectionBounds(store.getState().doc, store.getState().selection)!;

// the panel's handlers, verbatim, parameterised by the chosen reference point
const setX = (store: ArtisanStore, ref: RefPoint, v: number) => {
  const b = bounds(store);
  const a = refAnchor(b, ref);
  store.transact("Move", (d) => Ops.Transform.translateItems(d, store.getState().selection, v - a.x, 0));
};
const setW = (store: ArtisanStore, ref: RefPoint, v: number) => {
  const b = bounds(store);
  const a = refAnchor(b, ref);
  if (b.width <= 0) return;
  store.transact("Resize", (d) => Ops.Transform.scaleItems(d, store.getState().selection, v / b.width, 1, a));
};
const setH = (store: ArtisanStore, ref: RefPoint, v: number) => {
  const b = bounds(store);
  const a = refAnchor(b, ref);
  if (b.height <= 0) return;
  store.transact("Resize", (d) => Ops.Transform.scaleItems(d, store.getState().selection, 1, v / b.height, a));
};

// one rect at (100,100,40,20)
const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const r = makeRect(100, 100, 40, 20, 0, 0, { fill: solid(rgba(200, 100, 100)) });
  doc.layers[0].items.push(r);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([r.id]);
  return { store, id: r.id };
};
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

describe("Transform panel — reference point", () => {
  it("W from top-left grows rightward (left edge fixed)", () => {
    const { store } = setup();
    setW(store, "tl", 80);
    const b = bounds(store);
    expect(near(b.x, 100)).toBe(true); // left edge unchanged
    expect(near(b.width, 80)).toBe(true);
  });

  it("W from centre grows symmetrically (centre fixed)", () => {
    const { store } = setup();
    setW(store, "mc", 80); // 40 → 80 around centre x=120
    const b = bounds(store);
    expect(near(b.x, 80)).toBe(true); // 120 - 80/2
    expect(near(b.width, 80)).toBe(true);
    expect(near(b.x + b.width / 2, 120)).toBe(true); // centre held
  });

  it("W from bottom-right grows leftward (right edge fixed)", () => {
    const { store } = setup();
    setW(store, "br", 80); // around x=140 (right edge)
    const b = bounds(store);
    expect(near(b.x + b.width, 140)).toBe(true); // right edge held
    expect(near(b.width, 80)).toBe(true);
  });

  it("H from middle grows symmetrically (vertical centre fixed)", () => {
    const { store } = setup();
    setH(store, "mc", 40); // 20 → 40 around centre y=110
    const b = bounds(store);
    expect(near(b.y, 90)).toBe(true); // 110 - 40/2
    expect(near(b.y + b.height / 2, 110)).toBe(true);
  });

  it("X with the centre reference moves so the centre lands on the value", () => {
    const { store } = setup();
    setX(store, "mc", 200); // centre.x → 200
    const b = bounds(store);
    expect(near(b.x + b.width / 2, 200)).toBe(true);
    expect(near(b.x, 180)).toBe(true); // 200 - 40/2
  });

  it("X with the default top-left reference moves the left edge (unchanged behaviour)", () => {
    const { store } = setup();
    setX(store, "tl", 300);
    expect(near(bounds(store).x, 300)).toBe(true);
  });
});
