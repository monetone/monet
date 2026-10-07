// io/svg-appearance-stack.test - export explicit Appearance stacks

import { describe, it, expect } from "vitest";
import { IO, defaultStroke, makeDocument, makeRect, makeText, rgba, solid, type AppearanceStack } from "../index";

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

describe("exportSVG appearance stack", () => {
  it("duplicates geometry per appearance entry in paint order", () => {
    const doc = makeDocument();
    doc.layers[0].items.push(makeRect(0, 0, 40, 40, 0, 0, { appearance: stack }));

    const svg = IO.exportSVG(doc);
    expect(svg).toContain('data-appearance-stack="true"');
    expect(svg).toContain('data-appearance-entry="fill-base"');
    expect(svg).toContain('data-appearance-entry="stroke-top"');
    const red = svg.indexOf('fill="rgb(220,0,0)"');
    const blue = svg.indexOf('fill="rgb(0,0,220)"');
    const stroke = svg.indexOf('stroke="rgb(0,160,60)"');
    expect(red).toBeGreaterThan(-1);
    expect(blue).toBeGreaterThan(red);
    expect(stroke).toBeGreaterThan(blue);
    expect(svg).toContain('opacity="0.5"');
    expect(svg).toContain("feGaussianBlur");
  });

  it("exports the full visible appearance stack for text", () => {
    const doc = makeDocument();
    const text = makeText("Hi", 0, 24, { fill: solid(HIDDEN) });
    text.runs = [{ text: "H", fill: solid(HIDDEN) }, { text: "i" }];
    text.appearance = {
      ...stack,
      entries: [{ id: "hidden", kind: "fill", paint: solid(HIDDEN), visible: false }, ...stack.entries],
    };
    doc.layers[0].items.push(text);

    const svg = IO.exportSVG(doc);

    expect(svg).toContain('data-appearance-stack="true"');
    expect(svg.match(/<text /g)).toHaveLength(3);
    const red = svg.indexOf('fill="rgb(220,0,0)"');
    const blue = svg.indexOf('fill="rgb(0,0,220)"');
    const stroke = svg.indexOf('stroke="rgb(0,160,60)"');
    expect(red).toBeGreaterThan(-1);
    expect(blue).toBeGreaterThan(red);
    expect(stroke).toBeGreaterThan(blue);
    expect(svg).not.toContain('rgb(240,120,0)');
    expect(svg).toContain('opacity="0.5"');
    expect(svg).toContain("feGaussianBlur");
  });
});
