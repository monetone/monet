// ─────────────────────────────────────────────────────────────
// render/blend-mode.test — blend modes (Transparency panel) (parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Transparency panel blend modes (Multiply, Screen,
// Overlay, …) map 1:1 onto CSS/SVG mix-blend-mode. The renderer and exporter emit
// it; setBlendMode sets it.

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ItemNode } from "./item-node";
import { IO, makeDocument, makeRect, Ops, Query, solid, rgba, type BlendMode } from "../engine";

const rectBlend = (mode: BlendMode) => {
  const r = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(rgba(200, 0, 0)) });
  r.blendMode = mode;
  return r;
};

describe("blend mode — render / export / op", () => {
  it("renders mix-blend-mode for a non-normal blend mode", () => {
    expect(renderToStaticMarkup(createElement(ItemNode, { item: rectBlend("multiply") }))).toContain("mix-blend-mode:multiply");
  });

  it("normal blend mode emits no mix-blend-mode", () => {
    expect(renderToStaticMarkup(createElement(ItemNode, { item: rectBlend("normal") }))).not.toContain("mix-blend-mode");
  });

  it("exports mix-blend-mode in the SVG style", () => {
    const doc = makeDocument();
    const r = makeRect(10, 10, 40, 40, 0, 0, { fill: solid(rgba(200, 0, 0)) });
    r.blendMode = "screen";
    doc.layers[0].items.push(r);
    expect(IO.exportSVG(doc)).toContain("mix-blend-mode:screen");
  });

  it("setBlendMode sets the mode on the selected item", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(rgba(200, 0, 0)) });
    Ops.Items.addItem(doc, r);
    Ops.Items.setBlendMode(doc, [r.id], "overlay");
    expect(Query.getItem(doc, r.id)!.blendMode).toBe("overlay");
  });
});
