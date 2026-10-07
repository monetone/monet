// @vitest-environment happy-dom
// ─────────────────────────────────────────────────────────────
// gradient-stroke.test — gradient applied to the active paint (stroke/fill)
// ─────────────────────────────────────────────────────────────
// The Gradient panel edits whichever paint is active. This locks the building
// block it relies on (applyPaintToActive honours state.activePaint) and that a
// gradient STROKE renders/exports/round-trips.

import { describe, it, expect } from "vitest";
import { ArtisanStore, makeDocument, makeRect, makePath, makeAnchor as anchor, defaultStroke, linearGradient, IO, Query, solid, rgba } from "./engine";
import type { Item, PathItem } from "./engine";
import { applyPaintToActive } from "./ui/paint-apply";
import { importSVG } from "./io/import/svg";

const RED = rgba(220, 0, 0);

const withRect = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const r = makeRect(40, 40, 120, 80, 0, 0, { fill: solid(RED), stroke: { ...defaultStroke(solid(rgba(0, 0, 0))), width: 6 } });
  doc.layers[0].items.push(r);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([r.id]);
  return { store, r };
};

describe("gradient on the active paint target", () => {
  it("applies a gradient to the STROKE when activePaint is 'stroke' (fill untouched)", () => {
    const { store, r } = withRect();
    store.setActivePaint("stroke");
    applyPaintToActive(store, linearGradient());
    const it = Query.getItem(store.getState().doc, r.id)!;
    expect(it.stroke.paint.type).toBe("gradient");
    expect(it.fill).toEqual(solid(RED)); // fill left alone
  });

  it("applies a gradient to the FILL when activePaint is 'fill' (stroke untouched)", () => {
    const { store, r } = withRect();
    store.setActivePaint("fill");
    applyPaintToActive(store, linearGradient());
    const it = Query.getItem(store.getState().doc, r.id)!;
    expect(it.fill.type).toBe("gradient");
    expect(it.stroke.paint.type).toBe("solid"); // stroke left alone
  });
});

const findPath = (doc: ReturnType<typeof makeDocument>): PathItem | null => {
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

describe("gradient stroke round-trips", () => {
  it("exports a gradient stroke to SVG and re-imports it as a gradient stroke", () => {
    const doc = makeDocument();
    const p = makePath(
      { closed: false, anchors: [anchor({ x: 60, y: 60 }), anchor({ x: 260, y: 60 })] },
      { stroke: { ...defaultStroke(linearGradient()), width: 8 } },
    );
    doc.layers[0].items.push(p);
    const svg = IO.exportSVG(doc);
    expect(svg).toContain("<linearGradient");
    expect(svg).toContain('gradientUnits="userSpaceOnUse"');
    expect(svg).toMatch(/stroke="url\(#/);
    const back = importSVG(svg);
    const paint = findPath(back)!.stroke.paint;
    expect(paint.type).toBe("gradient");
    if (paint.type === "gradient") {
      expect(paint.gradient.x1).toBeCloseTo(0);
      expect(paint.gradient.y1).toBeCloseTo(0);
      expect(paint.gradient.x2).toBeCloseTo(1);
      expect(paint.gradient.y2).toBeCloseTo(0);
    }
  });

  it("persists a gradient stroke through the .artisan serializer", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 40, 40, 0, 0, { stroke: { ...defaultStroke(linearGradient()), width: 4 } });
    doc.layers[0].items.push(r);
    const restored = IO.deserializeDocument(IO.serializeDocument(doc));
    expect(restored.layers[0].items[0].stroke.paint.type).toBe("gradient");
  });
});
