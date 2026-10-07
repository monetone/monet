// ─────────────────────────────────────────────────────────────
// render/outline-mode.test — View ▸ Outline (wireframe) parity
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator "Outline view" (⌘Y) — artwork is drawn as
// wireframe paths (no fills, thin uniform strokes), and placed images appear as
// an outlined box with an X. ItemNode's `outline` prop drives this.

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ItemNode } from "./item-node";
import { makeRect, makeImage, solid, rgba } from "../engine";

const render = (item: Parameters<typeof ItemNode>[0]["item"], outline: boolean) =>
  renderToStaticMarkup(createElement(ItemNode, { item, outline }));

describe("render — Outline view (shapes)", () => {
  it("draws shapes with no fill and a thin non-scaling stroke", () => {
    const rect = makeRect(0, 0, 100, 60, 0, 0, { fill: solid(rgba(220, 0, 0)) });
    const svg = render(rect, true);
    expect(svg).toContain('fill="none"');
    expect(svg).toContain("accent-vector"); // OUTLINE_STROKE colour
    expect(svg).toContain("non-scaling-stroke"); // constant 1px at any zoom
  });

  it("paints the fill normally when NOT in outline mode", () => {
    const rect = makeRect(0, 0, 100, 60, 0, 0, { fill: solid(rgba(220, 0, 0)) });
    const svg = render(rect, false);
    expect(svg).not.toContain("accent-vector"); // uses the item's own paint
    expect(svg).not.toContain("non-scaling-stroke");
  });
});

describe("render — Outline view (images)", () => {
  const img = () => makeImage("data:image/png;base64,AAAA", 0, 0, 80, 60);

  it("draws a placed image as a crossed box (no raster)", () => {
    const svg = render(img(), true);
    expect(svg).not.toContain("<image"); // the raster is NOT drawn
    expect(svg).toContain("<rect"); // the bounding box …
    expect((svg.match(/<line/g) || []).length).toBe(2); // … plus the two diagonals (the X)
    expect(svg).toContain("accent-vector");
  });

  it("draws the actual raster when NOT in outline mode", () => {
    const svg = render(img(), false);
    expect(svg).toContain("<image");
    expect(svg).toContain("data:image/png");
    expect(svg).not.toContain("<line");
  });
});
