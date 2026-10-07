// ─────────────────────────────────────────────────────────────
// render/pattern.test — a pattern-filled shape renders a <pattern> def
// ─────────────────────────────────────────────────────────────
// Reference: Illustrator pattern swatch → SVG <pattern patternUnits=
// "userSpaceOnUse"> tiled by width/height; the shape's fill references it.

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ItemNode } from "./item-node";
import { makeRect, pattern, solid, rgba } from "../engine";

describe("ItemNode — pattern fill", () => {
  it("renders a <pattern> def (50×50, userSpaceOnUse) and references it from the shape's fill", () => {
    const tile = [makeRect(0, 0, 10, 10, 0, 0, { fill: solid(rgba(10, 20, 30)) })];
    const rect = makeRect(100, 100, 80, 80, 0, 0, { fill: pattern(tile, 50, 50) });
    const html = renderToStaticMarkup(createElement(ItemNode, { item: rect }));

    expect(html).toMatch(/<pattern[^>]*patternUnits="userSpaceOnUse"/);
    expect(html).toMatch(/<pattern[^>]*width="50"/);
    expect(html).toMatch(/<pattern[^>]*height="50"/);
    expect(html).toMatch(/fill="url\(#/); // the shape paints with the pattern
  });
});
