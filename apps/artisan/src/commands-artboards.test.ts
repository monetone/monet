// ─────────────────────────────────────────────────────────────
// commands-artboards.test — Object ▸ Artboards ▸ Fit to Selected Art / Artwork
// ─────────────────────────────────────────────────────────────
// Integration: Fit to Selected Art resizes the active artboard to the selection's
// world bounds; Fit to Artwork Bounds fits all artwork. Both undoable, both no-op
// when there is nothing to fit.

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, makeDocument, makeRect, solid, rgba } from "./engine";

const rect = (x: number, y: number, w: number, h: number) => makeRect(x, y, w, h, 0, 0, { fill: solid(rgba(220, 0, 0)) });
const board = (store: ArtisanStore) => {
  const a = store.getState().doc.artboards[0];
  return { x: a.x, y: a.y, w: a.width, h: a.height };
};

const build = (...items: ReturnType<typeof rect>[]) => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  doc.artboards = [{ id: "A1", name: "AB", x: 0, y: 0, width: 400, height: 300 }];
  doc.activeArtboard = 0;
  items.forEach((it) => doc.layers[0].items.push(it));
  store.replaceDoc(doc, { markClean: true });
  return { store };
};

describe("commands.fitArtboardToSelection", () => {
  it("resizes the active artboard to the selection's bounds, undoably", () => {
    const r = rect(100, 100, 80, 60);
    const { store } = build(r);
    store.setSelection([r.id]);
    commands.fitArtboardToSelection(store);
    expect(board(store)).toEqual({ x: 100, y: 100, w: 80, h: 60 });

    store.undo();
    expect(board(store)).toEqual({ x: 0, y: 0, w: 400, h: 300 });
  });

  it("no-op (no undo entry) with an empty selection", () => {
    const r = rect(100, 100, 80, 60);
    const { store } = build(r);
    store.clearSelection();
    const before = store.canUndo;
    commands.fitArtboardToSelection(store);
    expect(store.canUndo).toBe(before);
    expect(board(store)).toEqual({ x: 0, y: 0, w: 400, h: 300 }); // untouched
  });
});

describe("commands.fitArtboardToArtwork", () => {
  it("resizes the active artboard to the combined bounds of all artwork", () => {
    const { store } = build(rect(100, 100, 50, 50), rect(200, 200, 60, 40));
    commands.fitArtboardToArtwork(store);
    // union of (100,100,50,50) and (200,200,60,40) → (100,100) … (260,240) = 160×140
    expect(board(store)).toEqual({ x: 100, y: 100, w: 160, h: 140 });
  });

  it("no-op (no undo entry) when there is no artwork", () => {
    const { store } = build();
    const before = store.canUndo;
    commands.fitArtboardToArtwork(store);
    expect(store.canUndo).toBe(before);
    expect(board(store)).toEqual({ x: 0, y: 0, w: 400, h: 300 }); // untouched
  });
});

describe("commands.rearrangeArtboards", () => {
  const multi = () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    doc.artboards = [
      { id: "A", name: "A", x: 0, y: 0, width: 100, height: 80 },
      { id: "B", name: "B", x: 500, y: 200, width: 120, height: 90 },
      { id: "C", name: "C", x: 50, y: 400, width: 80, height: 80 },
    ];
    doc.activeArtboard = 0;
    store.replaceDoc(doc, { markClean: true });
    return store;
  };
  const rects = (store: ArtisanStore) => store.getState().doc.artboards.map((a) => ({ x: a.x, y: a.y }));

  it("lays the artboards out in a single row (20px gap), anchored at the first, undoably", () => {
    const store = multi();
    commands.rearrangeArtboards(store);
    // A stays (0,0); B at 0+100+20=120; C at 120+120+20=260; all top-aligned at y=0
    expect(rects(store)).toEqual([
      { x: 0, y: 0 },
      { x: 120, y: 0 },
      { x: 260, y: 0 },
    ]);

    store.undo();
    expect(rects(store)).toEqual([
      { x: 0, y: 0 },
      { x: 500, y: 200 },
      { x: 50, y: 400 },
    ]);
  });

  it("no-op (no undo entry) with fewer than two artboards", () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    doc.artboards = [{ id: "A", name: "A", x: 7, y: 9, width: 100, height: 80 }];
    store.replaceDoc(doc, { markClean: true });
    const before = store.canUndo;
    commands.rearrangeArtboards(store);
    expect(store.canUndo).toBe(before);
    expect(store.getState().doc.artboards[0]).toMatchObject({ x: 7, y: 9 }); // untouched
  });
});

describe("commands.convertToArtboards", () => {
  it("adds one artboard matching each selected object's world bounds, undoably", () => {
    const a = rect(100, 100, 80, 60);
    const b = rect(250, 50, 60, 90);
    const { store } = build(a, b);
    store.setSelection([a.id, b.id]);
    commands.convertToArtboards(store);
    const abs = store.getState().doc.artboards;
    expect(abs).toHaveLength(3); // the original + one per selected object
    const added = abs.slice(1).map((x) => ({ x: x.x, y: x.y, w: x.width, h: x.height }));
    expect(added).toContainEqual({ x: 100, y: 100, w: 80, h: 60 });
    expect(added).toContainEqual({ x: 250, y: 50, w: 60, h: 90 });

    store.undo();
    expect(store.getState().doc.artboards).toHaveLength(1); // back to the original
  });

  it("no-op (no undo entry) with an empty selection", () => {
    const { store } = build(rect(0, 0, 10, 10));
    store.clearSelection();
    const before = store.canUndo;
    commands.convertToArtboards(store);
    expect(store.canUndo).toBe(before);
    expect(store.getState().doc.artboards).toHaveLength(1);
  });
});
