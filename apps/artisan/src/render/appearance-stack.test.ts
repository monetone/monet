// render/appearance-stack.test - ordered multi-fill/stroke rendering

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Path, defaultStroke, makeAnchor as anchor, makeCompound, makePath, makeRect, makeText, noPaint, rgba, solid, type AppearanceStack } from "../engine";
import { ItemNode } from "./item-node";

const RED = rgba(220, 0, 0);
const BLUE = rgba(0, 0, 220);
const GREEN = rgba(0, 160, 60);
const HIDDEN = rgba(240, 120, 0);

const stack: AppearanceStack = {
  entries: [
    { id: "fill-base", kind: "fill", paint: solid(RED) },
    { id: "fill-top", kind: "fill", paint: solid(BLUE), opacity: 0.5 },
    { id: "stroke-top", kind: "stroke", stroke: { ...defaultStroke(solid(GREEN)), width: 6 } },
  ],
  effectPlacements: [{ scope: "entry", entryId: "fill-top", effect: { type: "blur", radius: 2 } }],
};

describe("ItemNode appearance stack rendering", () => {
  it("replays visible appearance entries in bottom-to-top order", () => {
    const rect = makeRect(0, 0, 40, 40, 0, 0, { appearance: stack });
    // Render inside an <svg> as the canvas does: standalone, React resolves the
    // HTML namespace and warns that <feGaussianBlur> is "incorrect casing".
    const html = renderToStaticMarkup(createElement("svg", null, createElement(ItemNode, { item: rect })));

    expect(html).toContain('data-appearance-stack="true"');
    const red = html.indexOf('fill="rgb(220,0,0)"');
    const blue = html.indexOf('fill="rgb(0,0,220)"');
    const stroke = html.indexOf('stroke="rgb(0,160,60)"');
    expect(red).toBeGreaterThan(-1);
    expect(blue).toBeGreaterThan(red);
    expect(stroke).toBeGreaterThan(blue);
    expect(html).toContain('opacity="0.5"');
    expect(html).toContain("<feGaussianBlur");
  });

  it("replays the full visible appearance stack for text", () => {
    const text = makeText("Hi", 0, 24, { fill: solid(HIDDEN) });
    text.runs = [{ text: "H", fill: solid(HIDDEN) }, { text: "i" }];
    text.appearance = {
      ...stack,
      entries: [{ id: "hidden", kind: "fill", paint: solid(HIDDEN), visible: false }, ...stack.entries],
    };

    const html = renderToStaticMarkup(createElement("svg", null, createElement(ItemNode, { item: text })));

    expect(html).toContain('data-appearance-stack="true"');
    expect(html.match(/<text /g)).toHaveLength(3);
    const red = html.indexOf('fill="rgb(220,0,0)"');
    const blue = html.indexOf('fill="rgb(0,0,220)"');
    const stroke = html.indexOf('stroke="rgb(0,160,60)"');
    expect(red).toBeGreaterThan(-1);
    expect(blue).toBeGreaterThan(red);
    expect(stroke).toBeGreaterThan(blue);
    expect(html).not.toContain('rgb(240,120,0)');
    expect(html).toContain('opacity="0.5"');
    expect(html).toContain("<feGaussianBlur");
  });

  it("replays fills and strokes for stacked area text", () => {
    const text = makeText("Wrapped", 0, 24, { fill: solid(HIDDEN) });
    text.boxWidth = 160;
    text.boxHeight = 80;
    text.appearance = stack;

    const html = renderToStaticMarkup(createElement("svg", null, createElement(ItemNode, { item: text })));

    expect(html.match(/<foreignObject/g)).toHaveLength(3);
    expect(html).toContain("color:rgb(220,0,0)");
    expect(html).toContain("color:rgb(0,0,220)");
    expect(html).toContain("-webkit-text-stroke-color:rgb(0,160,60)");
    expect(html).toContain("-webkit-text-stroke-width:6px");
  });

  it("renders a width profile from its appearance stroke entry", () => {
    const path = makePath(
      { closed: false, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 100, y: 0 })] },
      {
        fill: noPaint(),
        stroke: defaultStroke(noPaint()),
        appearance: {
          entries: [{ id: "wide", kind: "stroke", stroke: { ...defaultStroke(solid(GREEN)), width: 10, widthProfile: [1, 2], align: "inside" } }],
        },
      },
    );

    const html = renderToStaticMarkup(createElement("svg", null, createElement(ItemNode, { item: path })));

    expect(html).toContain('data-appearance-variable-width="true"');
    expect(html).toContain('fill="rgb(0,160,60)"');
    expect(html).not.toContain('data-stroke-align="inside"');
  });

  it("slices a compound width profile in flat subpath anchor order", () => {
    const subpaths = [
      { closed: false, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 100, y: 0 })] },
      { closed: false, anchors: [anchor({ x: 0, y: 40 }), anchor({ x: 100, y: 40 })] },
    ];
    const compound = makeCompound(subpaths, {
      fill: noPaint(),
      stroke: { ...defaultStroke(solid(GREEN)), width: 10, widthProfile: [1, 1, 1, 3] },
    });

    const html = renderToStaticMarkup(createElement("svg", null, createElement(ItemNode, { item: compound })));
    const ribbon = Path.widthOutlines(subpaths, [1, 1, 1, 3], 10).map(Path.toSVGPath).join(" ");

    expect(html).toContain(`d="${ribbon}"`);
    expect(html).not.toContain('stroke-width="10"');
  });

  it("defines and references unique arrowhead markers for every appearance stroke", () => {
    const path = makePath(
      { closed: false, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 100, y: 0 })] },
      {
        appearance: {
          entries: [
            { id: "red-arrow", kind: "stroke", stroke: { ...defaultStroke(solid(RED)), width: 3, endArrow: "triangle" } },
            { id: "blue-arrow", kind: "stroke", stroke: { ...defaultStroke(solid(BLUE)), width: 6, endArrow: "circle" } },
          ],
        },
      },
    );

    const html = renderToStaticMarkup(createElement("svg", null, createElement(ItemNode, { item: path })));

    expect(html).toContain(`id="${path.id}-ap0-ae"`);
    expect(html).toContain(`marker-end="url(#${path.id}-ap0-ae)"`);
    expect(html).toContain(`id="${path.id}-ap1-ae"`);
    expect(html).toContain(`marker-end="url(#${path.id}-ap1-ae)"`);
  });
});
