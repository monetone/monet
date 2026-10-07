// ─────────────────────────────────────────────────────────────
// render/artboard-render.test — multiple artboards overlay (parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator supports multiple artboards, each drawn as a white
// page rect; in Outline view they become accent-stroked outlines.

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ArtboardBackgrounds } from "./document-content";

const boards = () => [
  { id: "A1", name: "Artboard 1", x: 0, y: 0, width: 200, height: 150 },
  { id: "A2", name: "Artboard 2", x: 300, y: 0, width: 120, height: 120 },
];

describe("renderer — artboards (ArtboardBackgrounds)", () => {
  it("draws one page rect per artboard at its bbox", () => {
    const html = renderToStaticMarkup(createElement(ArtboardBackgrounds, { artboards: boards() }));
    expect(html).toContain('data-artboard="A1"');
    expect(html).toContain('data-artboard="A2"');
    expect(html).toContain('width="200"');
    expect(html).toContain('width="120"');
    expect(html).toContain('x="300"'); // the second board is offset
  });

  it("Outline view renders artboards as accent, non-scaling outlines", () => {
    const html = renderToStaticMarkup(createElement(ArtboardBackgrounds, { artboards: boards(), outline: true }));
    expect(html).toContain("var(--accent-vector");
    expect(html).toContain("non-scaling-stroke");
  });
});
