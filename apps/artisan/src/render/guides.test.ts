// ─────────────────────────────────────────────────────────────
// render/guides.test — ruler guides overlay rendering
// ─────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Guides } from "./guides";
import type { Guide, Point } from "../engine";

// a view at zoom 2, translate (50,30): screen = world*2 + t
const w2s = (p: Point): Point => ({ x: p.x * 2 + 50, y: p.y * 2 + 30 });
const render = (guides: Guide[], show = true) =>
  renderToStaticMarkup(createElement(Guides, { guides, show, worldToScreen: w2s, width: 800, height: 600 }));

describe("Guides overlay", () => {
  it("renders a horizontal guide as a full-width line at its world-y", () => {
    const html = render([{ id: "g1", orientation: "h", pos: 100 }]);
    expect(html).toMatch(/data-guide="h"/);
    expect(html).toMatch(/y1="230"/); // 100*2 + 30
    expect(html).toMatch(/y2="230"/);
    expect(html).toMatch(/x1="0"/);
    expect(html).toMatch(/x2="800"/); // spans the full width
  });

  it("renders a vertical guide as a full-height line at its world-x", () => {
    const html = render([{ id: "g1", orientation: "v", pos: 50 }]);
    expect(html).toMatch(/data-guide="v"/);
    expect(html).toMatch(/x1="150"/); // 50*2 + 50
    expect(html).toMatch(/x2="150"/);
    expect(html).toMatch(/y1="0"/);
    expect(html).toMatch(/y2="600"/); // spans the full height
  });

  it("renders nothing when hidden or empty", () => {
    expect(render([{ id: "g", orientation: "h", pos: 0 }], false)).toBe("");
    expect(render([])).toBe("");
  });
});
