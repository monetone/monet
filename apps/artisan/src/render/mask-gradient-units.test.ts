// render/mask-gradient-units.test — viewport-independent masks + line-safe gradients

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  IO,
  defaultStroke,
  linearGradient,
  makeAnchor as anchor,
  makeDocument,
  makeLine,
  makePath,
  makeRect,
  radialGradient,
  rgba,
  solid,
} from "../engine";
import { ItemNode } from "./item-node";

const render = (item: Parameters<typeof ItemNode>[0]["item"]) =>
  renderToStaticMarkup(createElement("svg", null, createElement(ItemNode, { item })));

const exported = (item: Parameters<typeof ItemNode>[0]["item"]) => {
  const doc = makeDocument("Units", 200, 100);
  doc.layers[0].items.push(item);
  return IO.exportSVG(doc);
};

describe("opacity mask region units", () => {
  it("keeps percentage margins relative to far-offset artwork in render and export", () => {
    const item = makePath(
      { closed: true, anchors: [anchor({ x: 1_000, y: 800 }), anchor({ x: 1_100, y: 800 }), anchor({ x: 1_100, y: 900 })] },
      { fill: solid(rgba(220, 0, 0)) },
    );
    item.mask = [makeRect(1_000, 800, 100, 100, 0, 0, { fill: solid(rgba(255, 255, 255)) })];

    for (const svg of [render(item), exported(item)]) {
      expect(svg).toMatch(/<mask[^>]*maskUnits="objectBoundingBox"[^>]*x="-50%"[^>]*width="200%"/);
      expect(svg).not.toMatch(/<mask[^>]*maskUnits="userSpaceOnUse"[^>]*x="-50%"/);
    }
  });
});

describe("gradient units on a zero-height line", () => {
  it.each([
    ["linear", linearGradient(), ['x1="10"', 'y1="20"', 'x2="110"', 'y2="20"']],
    ["radial", radialGradient(), ['cx="60"', 'cy="20"', 'r="50"', 'fx="60"', 'fy="20"']],
  ] as const)("maps a %s gradient into user space for render and export", (_kind, paint, coords) => {
    const line = makeLine(10, 20, 110, 20, { stroke: { ...defaultStroke(paint), width: 8 } });
    for (const svg of [render(line), exported(line)]) {
      expect(svg).toContain('gradientUnits="userSpaceOnUse"');
      for (const coordinate of coords) expect(svg).toContain(coordinate);
    }
  });
});
