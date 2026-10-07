// ─────────────────────────────────────────────────────────────
// render/opacity.test — ItemNode renders element-level opacity
// ─────────────────────────────────────────────────────────────
// Reference: Illustrator Transparency opacity → SVG element `opacity` (0..1).
// The renderer puts it on the item's own node only when it differs from 1.

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ItemNode } from "./item-node";
import { makeRect, solid, rgba } from "../engine";

const opaqueRed = () => makeRect(10, 10, 50, 30, 0, 0, { fill: solid(rgba(220, 0, 0)) });

describe("ItemNode — opacity attribute", () => {
  it("renders opacity=\"0.5\" when the item is half-transparent", () => {
    const item = { ...opaqueRed(), opacity: 0.5 };
    const html = renderToStaticMarkup(createElement(ItemNode, { item }));
    expect(html).toMatch(/\sopacity="0\.5"/);
  });

  it("omits the opacity attribute at full opacity (no redundant attr)", () => {
    const item = { ...opaqueRed(), opacity: 1 };
    const html = renderToStaticMarkup(createElement(ItemNode, { item }));
    // a fully-opaque solid fill must not introduce any ` opacity="` either
    expect(html).not.toMatch(/\sopacity="/);
  });
});
