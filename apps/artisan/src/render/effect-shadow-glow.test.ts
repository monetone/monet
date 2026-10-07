// ─────────────────────────────────────────────────────────────
// render/effect-shadow-glow.test — Drop Shadow + Outer Glow effects (parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Effect ▸ Stylize. Drop Shadow = an offset, blurred,
// coloured copy behind the object (SVG feDropShadow); Outer Glow = a blurred
// coloured halo behind it (blur the SourceAlpha, flood a colour, merge behind the
// source). Rendered (live) and exported (static SVG) must both carry the effect.

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ItemNode } from "./item-node";
import { IO, makeDocument, makeRect, solid, rgba, type Effect } from "../engine";

const SHADOW: Effect = { type: "drop-shadow", dx: 6, dy: 8, blur: 4, color: { r: 0, g: 0, b: 0, a: 0.5 } };
const GLOW: Effect = { type: "glow", blur: 8, color: { r: 255, g: 240, b: 120, a: 0.9 } };
const rectWith = (effect: Effect) => {
  const r = makeRect(0, 0, 100, 60, 0, 0, { fill: solid(rgba(200, 120, 60)) });
  r.effects = [effect];
  return r;
};
const docWith = (effect: Effect) => {
  const doc = makeDocument();
  const r = makeRect(10, 10, 80, 60, 0, 0, { fill: solid(rgba(200, 120, 60)) });
  r.effects = [effect];
  doc.layers[0].items.push(r);
  return doc;
};

describe("renderer — drop shadow + outer glow", () => {
  it("drop-shadow renders a feDropShadow with dx/dy/stdDeviation/flood", () => {
    const html = renderToStaticMarkup(createElement(ItemNode, { item: rectWith(SHADOW) }));
    expect(html).toContain("<filter");
    expect(html).toContain("feDropShadow");
    expect(html).toContain('dx="6"');
    expect(html).toContain('dy="8"');
    expect(html).toContain('stdDeviation="4"');
    expect(html).toContain('flood-opacity="0.5"');
  });

  it("outer glow blurs the SourceAlpha, floods a colour, and merges behind the source", () => {
    const html = renderToStaticMarkup(createElement(ItemNode, { item: rectWith(GLOW) }));
    expect(html).toContain('in="SourceAlpha"');
    expect(html).toContain("feFlood");
    expect(html).toContain("feMerge");
    expect(html).not.toContain("feDropShadow"); // distinct from a drop shadow
  });
});

describe("SVG export — drop shadow + outer glow", () => {
  it("exports a drop shadow as feDropShadow", () => {
    const svg = IO.exportSVG(docWith(SHADOW));
    expect(svg).toContain("feDropShadow");
    expect(svg).toContain('dx="6"');
    expect(svg).toContain('dy="8"');
    expect(svg).toContain('stdDeviation="4"');
  });

  it("exports an outer glow as a flood + merge filter (not a drop shadow)", () => {
    const svg = IO.exportSVG(docWith(GLOW));
    expect(svg).toContain("feFlood");
    expect(svg).toContain("feMerge");
    expect(svg).not.toContain("feDropShadow");
  });
});
