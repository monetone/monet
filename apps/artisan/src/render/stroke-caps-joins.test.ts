// ─────────────────────────────────────────────────────────────
// render/stroke-caps-joins.test — Stroke panel: Cap / Join / Miter / Dash (parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Stroke panel. Cap (butt/round/projecting),
// Corner/Join (miter/round/bevel), Miter Limit, and Dashed Line map 1:1 onto SVG
// stroke-linecap / stroke-linejoin / stroke-miterlimit / stroke-dasharray /
// stroke-dashoffset. The renderer must emit them on the stroked node.

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ItemNode } from "./item-node";
import { makePath, makeAnchor as anchor, defaultStroke, solid, rgba } from "../engine";

const BLACK = rgba(0, 0, 0);
const render = (stroke: ReturnType<typeof defaultStroke>) => {
  const p = makePath(
    { closed: true, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 50, y: 0 }), anchor({ x: 50, y: 50 }), anchor({ x: 0, y: 50 })] },
    { fill: solid(rgba(200, 120, 60)), stroke },
  );
  return renderToStaticMarkup(createElement(ItemNode, { item: p }));
};

describe("renderer — stroke caps / joins / miter / dashes", () => {
  it("emits round cap, bevel join, the miter limit, and the dash pattern", () => {
    const html = render({ ...defaultStroke(solid(BLACK)), width: 4, cap: "round", join: "bevel", miterLimit: 8, dash: [6, 4], dashOffset: 2 });
    expect(html).toContain('stroke-linecap="round"');
    expect(html).toContain('stroke-linejoin="bevel"');
    expect(html).toContain('stroke-miterlimit="8"');
    expect(html).toContain('stroke-dasharray="6,4"');
    expect(html).toContain('stroke-dashoffset="2"');
  });

  it("emits the default miter limit (10) and no dash array when undashed", () => {
    const html = render({ ...defaultStroke(solid(BLACK)), width: 4 }); // butt / miter / 10 / []
    expect(html).toContain('stroke-linecap="butt"');
    expect(html).toContain('stroke-linejoin="miter"');
    expect(html).toContain('stroke-miterlimit="10"');
    expect(html).not.toContain("stroke-dasharray");
  });

  it("projecting cap renders as the SVG 'square' linecap", () => {
    const html = render({ ...defaultStroke(solid(BLACK)), width: 4, cap: "square" });
    expect(html).toContain('stroke-linecap="square"');
  });
});
