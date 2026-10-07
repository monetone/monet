// @vitest-environment happy-dom
// ─────────────────────────────────────────────────────────────
// svg-arrowheads.test — stroke arrowhead SVG export + import round-trip
// ─────────────────────────────────────────────────────────────
// Stroke arrowheads export as SVG <marker>s (data-arrow carries the kind) +
// marker-start/marker-end; re-importing that SVG restores startArrow/endArrow.

import { describe, it, expect } from "vitest";
import { IO, makeDocument, makePath, makeAnchor as anchor, defaultStroke, linearGradient, solid, rgba } from "./engine";
import type { Document, Item, PathItem } from "./engine";
import { importSVG } from "./io/import/svg";

// Export nests each item/layer in wrapper <g>s, so recurse to find the path.
const findPath = (doc: Document): PathItem | null => {
  const walk = (items: Item[]): PathItem | null => {
    for (const it of items) {
      if (it.type === "path") return it;
      if (it.type === "group") {
        const r = walk(it.children);
        if (r) return r;
      }
    }
    return null;
  };
  for (const l of doc.layers) {
    const r = walk(l.items);
    if (r) return r;
  }
  return null;
};

const linePath = (start?: "triangle" | "circle" | "square" | "bar", end?: "triangle" | "circle" | "square" | "bar") => {
  const doc = makeDocument();
  const p = makePath(
    { closed: false, anchors: [anchor({ x: 100, y: 100 }), anchor({ x: 300, y: 100 })] },
    { stroke: { ...defaultStroke(solid(rgba(0, 0, 0))), width: 3, startArrow: start, endArrow: end } },
  );
  doc.layers[0].items.push(p);
  return doc;
};

describe("stroke arrowheads — SVG export", () => {
  it("emits a <marker> (data-arrow=kind) + marker-start/marker-end for an arrowed stroke", () => {
    const svg = IO.exportSVG(linePath("circle", "triangle"));
    expect(svg).toContain("<marker");
    expect(svg).toContain('data-arrow="triangle"');
    expect(svg).toContain('data-arrow="circle"');
    expect(svg).toMatch(/marker-start="url\(#/);
    expect(svg).toMatch(/marker-end="url\(#/);
  });

  it("emits no markers when the stroke has no arrowheads", () => {
    const svg = IO.exportSVG(linePath());
    expect(svg).not.toContain("<marker");
    expect(svg).not.toContain("marker-end");
  });

  it("falls back to black for a non-solid (gradient) stroke's arrowhead fill", () => {
    const doc = makeDocument();
    const p = makePath(
      { closed: false, anchors: [anchor({ x: 100, y: 100 }), anchor({ x: 300, y: 100 })] },
      { stroke: { ...defaultStroke(linearGradient()), width: 3, endArrow: "triangle" } },
    );
    doc.layers[0].items.push(p);
    const svg = IO.exportSVG(doc);
    expect(svg).toContain("<marker");
    expect(svg).toContain('fill="#000000"'); // no solid colour to sample → black
  });
});

describe("stroke arrowheads — SVG import round-trip", () => {
  it("restores startArrow/endArrow from the exported markers", () => {
    const svg = IO.exportSVG(linePath("circle", "triangle"));
    const back = importSVG(svg);
    const path = findPath(back)!;
    expect(path.stroke.startArrow).toBe("circle");
    expect(path.stroke.endArrow).toBe("triangle");
  });
});

describe("stroke arrowheads — .artisan round-trip", () => {
  it("persists startArrow/endArrow through serializeDocument/deserializeDocument", () => {
    const doc = linePath("bar", "square");
    const restored = IO.deserializeDocument(IO.serializeDocument(doc));
    const path = restored.layers.flatMap((l) => l.items).find((i) => i.type === "path")!;
    expect(path.stroke.startArrow).toBe("bar");
    expect(path.stroke.endArrow).toBe("square");
  });
});
