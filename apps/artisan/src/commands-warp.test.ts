// ─────────────────────────────────────────────────────────────
// commands-warp.test — Effect ▸ Warp (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Integration: Effect ▸ Warp ▸ Arc / Arc Lower / Arc Upper bends the selection
// along a parabolic arc in one undoable transaction.

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, makeDocument, makePath, makeAnchor as anchor, Query } from "./engine";
import type { PathItem } from "./engine";

const diamond = () => ({
  closed: true,
  anchors: [anchor({ x: 50, y: 0 }), anchor({ x: 100, y: 50 }), anchor({ x: 50, y: 100 }), anchor({ x: 0, y: 50 })],
});
const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const p = makePath(diamond());
  doc.layers[0].items.push(p);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([p.id]);
  return { store, p };
};
const points = (store: ArtisanStore, id: string) => (Query.getItem(store.getState().doc, id) as PathItem).geometry.anchors.map((a) => a.point);

describe("commands.warp", () => {
  it("Arc bows the centre vertices down, undoable", () => {
    const { store, p } = setup();
    commands.warp(store, "arc");
    const out = points(store, p.id);
    expect(out[0]).toEqual({ x: 50, y: 25 }); // top centre → +25 (bend 0.5 · h/2)
    expect(out[2]).toEqual({ x: 50, y: 125 }); // bottom centre → +25
    expect(out[1]).toEqual({ x: 100, y: 50 }); // right side pinned

    store.undo();
    expect(points(store, p.id)[0]).toEqual({ x: 50, y: 0 }); // restored
  });

  it("Arc Lower pins the top vertex; Arc Upper pins the bottom vertex", () => {
    const lower = setup();
    commands.warp(lower.store, "arc-lower");
    expect(points(lower.store, lower.p.id)[0]).toEqual({ x: 50, y: 0 }); // top unmoved

    const upper = setup();
    commands.warp(upper.store, "arc-upper");
    expect(points(upper.store, upper.p.id)[2]).toEqual({ x: 50, y: 100 }); // bottom unmoved
  });

  it("Flag ripples the shape along a sine; Bulge swells its centre vertically", () => {
    // A diamond's top & bottom vertices sit at the horizontal centre (s=0.5,
    // sin=0) so Flag leaves them put, but Bulge (parabola at u=0) moves them.
    const flag = setup();
    commands.warp(flag.store, "flag");
    const flagTop = points(flag.store, flag.p.id)[0];
    expect(flagTop.x).toBe(50);
    expect(flagTop.y).toBeCloseTo(0, 9); // top vertex at s=0.5 → sin(π) ≈ 0, no ripple

    const bulge = setup();
    commands.warp(bulge.store, "bulge");
    expect(points(bulge.store, bulge.p.id)[0]).toEqual({ x: 50, y: -25 }); // centre swells up
    expect(points(bulge.store, bulge.p.id)[1]).toEqual({ x: 100, y: 50 }); // side pinned
  });

  it("Wave ripples twice across the width; Rise shears the right edge up", () => {
    // Wave: a path with bbox {0,0,100,100} and an anchor at s=0.125 (x=12.5)
    // shifts +25 (25·sin(π/2)); the corner samples at s=0,1 stay put.
    const store = new ArtisanStore();
    const doc = makeDocument();
    const p = makePath({ closed: true, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 12.5, y: 0 }), anchor({ x: 100, y: 0 }), anchor({ x: 0, y: 100 })] });
    doc.layers[0].items.push(p);
    store.replaceDoc(doc, { markClean: true });
    store.setSelection([p.id]);
    commands.warp(store, "wave");
    expect(points(store, p.id)[1]).toEqual({ x: 12.5, y: 25 });

    // Rise: on the diamond the left vertex is pinned and the right rises by 50.
    const r = setup();
    commands.warp(r.store, "rise");
    const out = points(r.store, r.p.id);
    expect(out[3]).toEqual({ x: 0, y: 50 }); // left pinned (s=0)
    expect(out[1]).toEqual({ x: 100, y: 0 }); // right rises 50 (s=1)
  });

  it("respects a custom bend amount", () => {
    const { store, p } = setup();
    commands.warp(store, "arc", { bend: 1 });
    expect(points(store, p.id)[0]).toEqual({ x: 50, y: 50 }); // bend 1 · h/2 = 50
  });

  it("no-op when nothing is selected", () => {
    const { store } = setup();
    store.clearSelection();
    const before = store.canUndo;
    commands.warp(store, "arc");
    expect(store.canUndo).toBe(before);
  });
});
