// The view transform shared by the main canvas and the Window ▸ Arrange panes,
// and Match Zoom / Location / Rotation between two differently sized views.
import { describe, expect, it } from "vitest";
import { docPointAt, matchedView, panToShow, viewCss, type PlacedView } from "./viewTransform";

const close = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 9);
  expect(a.y).toBeCloseTo(b.y, 9);
};

describe("view transform", () => {
  it("maps screen to document with the plain zoom/pan inverse at angle 0", () => {
    const v = { zoom: 2, panX: 10, panY: 20, rotationAngle: 0 };
    expect(docPointAt(v, 1, 100, 50, 30, 60)).toEqual({ x: 10, y: 20 });
    // Pixel aspect stretches x only.
    expect(docPointAt(v, 2, 100, 50, 50, 60)).toEqual({ x: 10, y: 20 });
  });

  it("places the document box with one CSS transform, turning about its centre (#477)", () => {
    // The main canvas, its panes and a float window all draw the document with this.
    expect(viewCss({ zoom: 2, panX: 10, panY: 20, rotationAngle: 30 }, 1.5, 100, 50))
      .toBe("translate(10px, 20px) translate(150px, 50px) rotate(30deg) translate(-150px, -50px) scale(3, 2)");
  });

  it("pans a document point back to the screen point it came from, rotated and stretched", () => {
    for (const [zoom, rotationAngle, par] of [[1, 0, 1], [3, 37, 1], [0.5, -120, 1.5], [8, 180, 0.9]]) {
      const d = { x: 17.25, y: 41.5 };
      const pan = panToShow(zoom, rotationAngle, par, 120, 80, d, 200, 150);
      close(docPointAt({ zoom, rotationAngle, ...pan }, par, 120, 80, 200, 150), d);
    }
  });
});

describe("Match Zoom / Location / Rotation onto a pane", () => {
  // The main canvas: 400% on a 200×100 document, rotated, in a big viewport.
  const main: PlacedView = { zoom: 4, panX: -300, panY: -120, rotationAngle: 30, viewport: { w: 800, h: 600 }, docW: 200, docH: 100 };
  // A small pane fitted to the same document.
  const pane: PlacedView = { zoom: 1, panX: 30, panY: 50, rotationAngle: 0, viewport: { w: 260, h: 200 }, docW: 200, docH: 100 };
  const centreOf = (v: PlacedView) => docPointAt(v, 1, v.docW, v.docH, v.viewport.w / 2, v.viewport.h / 2);
  const placed = (v: { zoom: number; panX: number; panY: number; rotationAngle: number }): PlacedView =>
    ({ ...pane, ...v });

  it("Match Location centres the pane on the document point at the canvas centre", () => {
    const out = matchedView(main, pane, { location: true });
    expect(out.zoom).toBe(1);
    expect(out.rotationAngle).toBe(0);
    close(centreOf(placed(out)), centreOf(main));
    // Not a raw pan copy: the pane is a different size.
    expect(out.panX).not.toBe(main.panX);
  });

  it("Match Zoom and Match Rotation turn about the pane's own centre", () => {
    const zoomed = matchedView(main, pane, { zoom: true });
    expect(zoomed).toMatchObject({ zoom: 4, rotationAngle: 0 });
    close(centreOf(placed(zoomed)), centreOf(pane));
    const turned = matchedView(main, pane, { rotation: true });
    expect(turned).toMatchObject({ zoom: 1, rotationAngle: 30 });
    close(centreOf(placed(turned)), centreOf(pane));
  });

  it("Match All takes the canvas's zoom and rotation and shows the same centre", () => {
    const out = matchedView(main, pane, { zoom: true, location: true, rotation: true });
    expect(out).toMatchObject({ zoom: 4, rotationAngle: 30 });
    close(centreOf(placed(out)), centreOf(main));
  });
});
