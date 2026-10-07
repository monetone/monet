// ─────────────────────────────────────────────────────────────
// render/area-text-style.test — area type honours decoration + caps
// ─────────────────────────────────────────────────────────────
// The area-type branch renders into a <foreignObject> with its own inline style,
// separate from the <text> branch's. Underline / strikethrough / All Caps /
// Small Caps are stored on the item and written by the SVG exporter, so leaving
// them out of that style makes them silently invisible on every area-type object.

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { makeText, type TextItem } from "../engine";
import { ItemNode } from "./item-node";

const render = (item: TextItem) => renderToStaticMarkup(createElement("svg", null, createElement(ItemNode, { item })));

const areaText = (patch: Partial<TextItem>): TextItem => {
  const t = makeText("Area text", 0, 0, { fontSize: 18 });
  t.boxWidth = 200;
  t.boxHeight = 100;
  return Object.assign(t, patch);
};

describe("area type inline style", () => {
  it("renders underline", () => {
    expect(render(areaText({ underline: true }))).toMatch(/text-decoration:\s*underline/);
  });

  it("renders strikethrough", () => {
    expect(render(areaText({ strikethrough: true }))).toMatch(/text-decoration:\s*line-through/);
  });

  it("renders both together", () => {
    const html = render(areaText({ underline: true, strikethrough: true }));
    expect(html).toMatch(/text-decoration:\s*underline line-through/);
  });

  it("renders All Caps", () => {
    expect(render(areaText({ caps: "all" }))).toMatch(/text-transform:\s*uppercase/);
  });

  it("renders Small Caps", () => {
    expect(render(areaText({ caps: "small" }))).toMatch(/font-variant:\s*small-caps/);
  });

  it("adds nothing when the attributes are unset", () => {
    const html = render(areaText({}));
    expect(html).not.toMatch(/text-decoration/);
    expect(html).not.toMatch(/text-transform/);
  });
});
