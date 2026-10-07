// ─────────────────────────────────────────────────────────────
// render/stroke-align.test — Illustrator "Align Stroke" (center/inside/outside)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Stroke panel "Align Stroke" — strokes can sit on
// the Centre (default), Inside, or Outside of the path. SVG only strokes on the
// centre, so the renderer emulates inside/outside by painting a 2×-weight stroke
// and clipping it TO (inside) or masking it OUT of (outside) the shape — leaving
// exactly `weight` of paint on the chosen side. These tests render ItemNode to
// static SVG markup (no DOM needed) and assert that structure.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// `react-dom/server` (only) warns that the camelCase SVG tag <clipPath> is
// "incorrect casing"; `react-dom` in the browser renders it fine (the app
// already ships <clipPath> for clip groups). Silence just that SSR-only noise.
let restoreErr: (() => void) | undefined;
beforeAll(() => {
  const orig = console.error;
  restoreErr = () => (console.error = orig);
  console.error = (...a: unknown[]) => {
    if (typeof a[0] === "string" && a[0].includes("incorrect casing")) return;
    orig(...(a as []));
  };
});
afterAll(() => restoreErr?.());
import { ItemNode } from "./item-node";
import { makeDocument, makeRect, Ops, Query, solid, rgba, defaultStroke, type Stroke } from "../engine";

const strokedRect = (align: Stroke["align"]) =>
  makeRect(0, 0, 100, 60, 0, 0, {
    fill: solid(rgba(200, 200, 200)),
    stroke: { ...defaultStroke(solid(rgba(0, 0, 0))), width: 10, align },
  });

const svgOf = (align: Stroke["align"]) => renderToStaticMarkup(createElement(ItemNode, { item: strokedRect(align) }));
const stackedSvgOf = (align: Stroke["align"]) => {
  const rect = makeRect(0, 0, 100, 60, 0, 0, {
    appearance: {
      entries: [{ id: "aligned", kind: "stroke", stroke: { ...defaultStroke(solid(rgba(0, 0, 0))), width: 10, align, cap: "square", dash: [4, 2] } }],
    },
  });
  return renderToStaticMarkup(createElement(ItemNode, { item: rect }));
};

describe("render — Align Stroke", () => {
  it("center: one centred stroke at the weight, no clip/mask emulation", () => {
    const svg = svgOf("center");
    expect(svg).toContain('stroke-width="10"');
    expect(svg).not.toContain("clip-path");
    expect(svg).not.toContain("data-stroke-align");
    expect(svg).not.toContain("<mask");
  });

  it("inside: clips a 2×-weight stroke TO the shape", () => {
    const svg = svgOf("inside");
    expect(svg).toContain('data-stroke-align="inside"');
    expect(svg).toContain("<clipPath"); // a clip region is defined …
    expect(svg).toContain("clip-path="); // … and applied to the stroke path
    expect(svg).toContain('stroke-width="20"'); // 2 × weight
    expect(svg).not.toContain("<mask"); // inside uses clip, not mask
  });

  it("outside: masks a 2×-weight stroke OUT of the shape", () => {
    const svg = svgOf("outside");
    expect(svg).toContain('data-stroke-align="outside"');
    expect(svg).toContain("<mask"); // an inverse mask is defined …
    expect(svg).toContain("mask="); // … and applied to the stroke path
    expect(svg).toContain('stroke-width="20"');
    // the inverse mask paints the shape black on a white field
    expect(svg).toContain('fill="white"');
    expect(svg).toContain('fill="black"');
  });

  it("inside/outside emit a separate fill path with no stroke", () => {
    for (const a of ["inside", "outside"] as const) {
      const svg = svgOf(a);
      // the dedicated fill path is stroke-less; the dedicated stroke path is fill-less
      expect(svg).toContain('stroke="none"');
      expect(svg).toContain('fill="none"');
    }
  });

  it.each(["inside", "outside"] as const)("%s: applies the same emulation to an appearance stroke entry", (align) => {
    const svg = stackedSvgOf(align);
    expect(svg).toContain(`data-stroke-align="${align}"`);
    expect(svg).toContain('stroke-width="20"');
    expect(svg).toContain('stroke-linecap="square"');
    expect(svg).toContain('stroke-dasharray="4,2"');
    expect(svg).toContain(align === "inside" ? "clip-path=" : "mask=");
  });
});

describe("ops.paint — applyStroke align", () => {
  it("defaults to center and round-trips inside/outside through the model", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 10, 10);
    Ops.Items.addItem(doc, r);
    expect(Query.getItem(doc, r.id)!.stroke.align).toBe("center");
    Ops.Paint.applyStroke(doc, [r.id], { align: "outside" });
    expect(Query.getItem(doc, r.id)!.stroke.align).toBe("outside");
    Ops.Paint.applyStroke(doc, [r.id], { align: "inside" });
    expect(Query.getItem(doc, r.id)!.stroke.align).toBe("inside");
  });
});
