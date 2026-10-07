// ─────────────────────────────────────────────────────────────
// render/effect-chain.test — stacked effects must chain, not restart
// ─────────────────────────────────────────────────────────────
// An SVG filter is a pipeline: each primitive should consume the previous
// stage's result. Feather / Outer Glow / Inner Glow re-read `SourceGraphic` and
// `SourceAlpha`, which are the ORIGINAL element — so any effect applied before
// one of them is computed and then thrown away. Illustrator's Appearance panel
// stacks effects cumulatively, so a Drop Shadow under a Feather must survive.

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IO, Ops, makeDocument, makeRect, solid, rgba, type Effect, type Item } from "../engine";
import { ItemNode } from "./item-node";

const render = (effects: Effect[]): string => {
  const item: Item = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(rgba(220, 0, 0)) });
  item.effects = effects;
  return renderToStaticMarkup(createElement("svg", null, createElement(ItemNode, { item })));
};

const SHADOW: Effect = { type: "drop-shadow", dx: 4, dy: 4, blur: 3, color: { r: 0, g: 0, b: 0, a: 0.5 } };

/** Primitives inside the <filter>, in document order. */
const prims = (html: string): string[] => {
  const f = /<filter\b[^>]*>([\s\S]*?)<\/filter>/.exec(html);
  return f ? (f[1].match(/<fe[A-Za-z]+\b[^>]*>/g) ?? []) : [];
};

describe("stacked effect filter chains", () => {
  it("a single effect still reads the source", () => {
    expect(prims(render([SHADOW])).length).toBeGreaterThan(0);
  });

  for (const [name, second] of [
    ["feather", { type: "feather", radius: 8 } as Effect],
    ["outer glow", { type: "glow", blur: 8, color: { r: 255, g: 240, b: 120, a: 0.9 } } as Effect],
    ["inner glow", { type: "inner-glow", blur: 8, color: { r: 255, g: 255, b: 255, a: 0.75 } } as Effect],
  ] as const) {
    it(`a drop shadow under a ${name} is not discarded`, () => {
      const list = prims(render([SHADOW, second]));
      // Only the FIRST stage may read the untouched source; everything after it
      // must consume a named result, or the shadow is computed and dropped.
      const readsSource = list.filter((p) => /\bin="Source(Graphic|Alpha)"/.test(p));
      expect(readsSource.length, `\n${list.join("\n")}\n`).toBeLessThanOrEqual(1);
      expect(list[0], `\n${list.join("\n")}\n`).toMatch(/feDropShadow/);
    });
  }

  it("three stacked effects stay connected end to end", () => {
    const list = prims(render([SHADOW, { type: "blur", radius: 2 }, { type: "feather", radius: 6 }]));
    expect(list.filter((p) => /\bin="Source(Graphic|Alpha)"/.test(p)).length).toBeLessThanOrEqual(1);
  });
});

// The SVG EXPORT path is a second implementation of the same filter chain, so it
// gets the same guarantee — otherwise an exported file (and Object ▸ Rasterize,
// which goes through export) disagrees with what the canvas showed.
describe("exported SVG effect chains", () => {
  const exportPrims = (effects: Effect[]): string[] => {
    const doc = makeDocument();
    const item = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(rgba(220, 0, 0)) });
    item.effects = effects;
    Ops.Items.addItem(doc, item);
    const svg = IO.exportSVG(doc);
    const f = /<filter\b[^>]*>([\s\S]*?)<\/filter>/.exec(svg);
    return f ? (f[1].match(/<fe[A-Za-z]+\b[^>]*>/g) ?? []) : [];
  };

  it("a drop shadow under a feather survives the export", () => {
    const list = exportPrims([SHADOW, { type: "feather", radius: 8 }]);
    expect(list.length).toBeGreaterThan(0);
    expect(list.filter((p) => /\bin="Source(Graphic|Alpha)"/.test(p)).length).toBeLessThanOrEqual(1);
  });

  it("two glows do not collide on the same result names", () => {
    const glow = (blur: number): Effect => ({ type: "glow", blur, color: { r: 255, g: 240, b: 120, a: 0.9 } });
    const list = exportPrims([glow(4), glow(9)]);
    const results = list.map((p) => /result="([^"]+)"/.exec(p)?.[1]).filter(Boolean);
    expect(new Set(results).size).toBe(results.length);
  });
});
