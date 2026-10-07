// ─────────────────────────────────────────────────────────────
// render/layer-visibility.test — hidden items are not drawn (parity)
// ─────────────────────────────────────────────────────────────
// Illustrator: a hidden object is not rendered. ItemNode must emit nothing for an
// invisible item (a locked-but-visible item still renders normally).

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ItemNode } from "./item-node";
import { makeRect, solid, rgba } from "../engine";

const rect = (over: Partial<{ visible: boolean; locked: boolean }> = {}) => {
  const r = makeRect(0, 0, 100, 60, 0, 0, { fill: solid(rgba(200, 120, 60)) });
  return Object.assign(r, over);
};

describe("renderer — hidden items are not drawn", () => {
  it("emits nothing for a hidden item", () => {
    expect(renderToStaticMarkup(createElement(ItemNode, { item: rect({ visible: false }) }))).toBe("");
  });

  it("renders a visible item", () => {
    expect(renderToStaticMarkup(createElement(ItemNode, { item: rect() }))).toContain("<rect");
  });

  it("a locked but visible item still renders (lock affects selection, not drawing)", () => {
    expect(renderToStaticMarkup(createElement(ItemNode, { item: rect({ locked: true }) }))).toContain("<rect");
  });
});
