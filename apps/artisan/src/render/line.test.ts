// ─────────────────────────────────────────────────────────────
// render/line.test — a Line item renders as an unfilled <line>
// ─────────────────────────────────────────────────────────────
// Reference: Illustrator Line Segment → SVG <line> with the two endpoints and
// no fill (a stroke-only primitive).

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ItemNode } from "./item-node";
import { makeLine, defaultStroke, solid, rgba } from "../engine";

describe("ItemNode — line", () => {
  it("renders a <line> with the endpoints and fill=none", () => {
    const ln = makeLine(0, 0, 200, 100, { stroke: defaultStroke(solid(rgba(0, 0, 0))) });
    const html = renderToStaticMarkup(createElement(ItemNode, { item: ln }));
    expect(html).toMatch(/<line[^>]*x1="0"[^>]*y1="0"[^>]*x2="200"[^>]*y2="100"/);
    expect(html).toMatch(/<line[^>]*fill="none"/);
  });
});
