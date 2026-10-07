// ─────────────────────────────────────────────────────────────
// render/slice-render.test — export slices overlay (parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Slice tool — slices are rectangular export
// regions drawn over the artwork (dashed border, numbered). The selected slice is
// highlighted with the accent colour.

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DocumentContent } from "./document-content";
import { makeDocument } from "../engine";

const docWithSlice = () => {
  const doc = makeDocument();
  doc.slices = [{ id: "S1", name: "Slice", x: 10, y: 20, width: 60, height: 40 }];
  return doc;
};

describe("renderer — export slices", () => {
  it("draws a dashed, non-scaling slice rect at its bbox", () => {
    const html = renderToStaticMarkup(createElement(DocumentContent, { doc: docWithSlice() }));
    expect(html).toContain('x="10"');
    expect(html).toContain('y="20"');
    expect(html).toContain('width="60"');
    expect(html).toContain('height="40"');
    expect(html).toContain('stroke-dasharray="4 3"');
    expect(html).toContain("non-scaling-stroke");
  });

  it("highlights the selected slice with the accent stroke", () => {
    const doc = docWithSlice();
    expect(renderToStaticMarkup(createElement(DocumentContent, { doc, selectedSlice: "S1" }))).toContain("var(--accent-vector");
    expect(renderToStaticMarkup(createElement(DocumentContent, { doc }))).toContain("rgba(120,180,255,0.7)");
  });

  it("numbers each slice (01, 02, …)", () => {
    const doc = makeDocument();
    doc.slices = [
      { id: "S1", name: "Slice", x: 0, y: 0, width: 30, height: 30 },
      { id: "S2", name: "Slice", x: 40, y: 0, width: 30, height: 30 },
    ];
    const html = renderToStaticMarkup(createElement(DocumentContent, { doc }));
    expect(html).toContain(">01<");
    expect(html).toContain(">02<");
  });
});
