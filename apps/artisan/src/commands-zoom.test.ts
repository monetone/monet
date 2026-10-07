// ─────────────────────────────────────────────────────────────
// commands-zoom.test — View ▸ Zoom commands (parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator — Zoom In/Out step the zoom around the view centre,
// Actual Size = 100%, Fit Artboard frames the active artboard, Reset Rotation
// returns the view angle to 0. Zoom is clamped to the allowed range.

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { ArtisanStore, makeDocument } from "./engine";
import { MIN_ZOOM, MAX_ZOOM } from "./tools/view";

const setup = () => {
  const store = new ArtisanStore();
  store.replaceDoc(makeDocument(), { markClean: true });
  store.setViewport({ width: 800, height: 600 });
  store.setView({ zoom: 1, tx: 0, ty: 0, angle: 0 });
  return store;
};
const view = (store: ArtisanStore) => store.getState().view;
const worldAtCentre = (store: ArtisanStore) => {
  const v = view(store);
  return { x: (400 - v.tx) / v.zoom, y: (300 - v.ty) / v.zoom }; // viewport centre = (400,300)
};

describe("commands — zoom", () => {
  it("Actual Size sets zoom to 100%", () => {
    const store = setup();
    store.setView({ zoom: 3.2 });
    commands.zoomActual(store);
    expect(view(store).zoom).toBe(1);
  });

  it("Zoom In ×1.25, Zoom Out ÷1.25", () => {
    const store = setup();
    commands.zoomIn(store);
    expect(view(store).zoom).toBeCloseTo(1.25);
    commands.zoomOut(store);
    expect(view(store).zoom).toBeCloseTo(1);
  });

  it("zooming keeps the world point under the viewport centre fixed", () => {
    const store = setup();
    const before = worldAtCentre(store);
    commands.zoomIn(store);
    const after = worldAtCentre(store);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it("Zoom In clamps at MAX, Zoom Out clamps at MIN", () => {
    const store = setup();
    for (let i = 0; i < 60; i++) commands.zoomIn(store);
    expect(view(store).zoom).toBe(MAX_ZOOM);
    for (let i = 0; i < 200; i++) commands.zoomOut(store);
    expect(view(store).zoom).toBe(MIN_ZOOM);
  });

  it("Fit Artboard frames the active artboard centred in the viewport", () => {
    const store = setup();
    const doc = store.getState().doc;
    doc.artboards = [{ id: "A1", name: "Artboard 1", x: 0, y: 0, width: 400, height: 300 }];
    store.replaceDoc(doc, { markClean: true });
    store.setViewport({ width: 800, height: 600 });
    commands.zoomFit(store);
    const v = view(store);
    expect(v.zoom).toBeCloseTo(1.7); // min(800·0.85/400, 600·0.85/300)
    expect(200 * v.zoom + v.tx).toBeCloseTo(400); // artboard centre → viewport centre
    expect(150 * v.zoom + v.ty).toBeCloseTo(300);
  });

  it("Reset Rotation sets the view angle to 0", () => {
    const store = setup();
    store.setView({ angle: 0.5 });
    commands.resetRotation(store);
    expect(view(store).angle).toBe(0);
  });

  it("Fit All in Window frames the union of every artboard, centred", () => {
    const store = setup();
    const doc = store.getState().doc;
    doc.artboards = [
      { id: "A1", name: "Artboard 1", x: 0, y: 0, width: 400, height: 300 },
      { id: "A2", name: "Artboard 2", x: 500, y: 0, width: 400, height: 300 },
    ];
    store.replaceDoc(doc, { markClean: true });
    store.setViewport({ width: 800, height: 600 });
    commands.zoomFitAll(store);
    const v = view(store);
    expect(v.zoom).toBeCloseTo(0.7556, 3); // min(800·0.85/900, 600·0.85/300) = 680/900
    expect(450 * v.zoom + v.tx).toBeCloseTo(400); // union centre (450,150) → viewport centre (400,300)
    expect(150 * v.zoom + v.ty).toBeCloseTo(300);
  });

  it("Fit All equals Fit Artboard for a single artboard", () => {
    const store = setup();
    const doc = store.getState().doc;
    doc.artboards = [{ id: "A1", name: "Artboard 1", x: 0, y: 0, width: 400, height: 300 }];
    store.replaceDoc(doc, { markClean: true });
    store.setViewport({ width: 800, height: 600 });
    commands.zoomFitAll(store);
    const fitAll = { ...view(store) };
    commands.zoomFit(store);
    expect(view(store)).toEqual(fitAll); // identical for one artboard
  });

  it("Fit All is a no-op with no artboards", () => {
    const store = setup();
    const doc = store.getState().doc;
    doc.artboards = [];
    store.replaceDoc(doc, { markClean: true });
    store.setView({ zoom: 2, tx: 33, ty: 44, angle: 0 });
    commands.zoomFitAll(store);
    expect(view(store)).toEqual({ zoom: 2, tx: 33, ty: 44, angle: 0 }); // unchanged
  });
});
