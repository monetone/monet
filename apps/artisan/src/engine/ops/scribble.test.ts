// ─────────────────────────────────────────────────────────────
// ops/scribble.test — Effect ▸ Stylize ▸ Scribble (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Reference: Illustrator Scribble fills a shape with one continuous back-and-forth
// stroke. A square at angle 0 hatched every 20 units gives an exact boustrophedon:
// horizontal segments at y = 10,30,50,70,90, joined left→right then right→left.

import { describe, it, expect } from "vitest";
import { makeDocument, makePath, makeCompound, makeRect, makeAnchor as anchor, Ops, Query, solid, noPaint, defaultStroke, rgba } from "../index";
import type { PathItem } from "../index";

const RED = rgba(220, 0, 0);
const square = (s = 100) => ({
  closed: true,
  anchors: [anchor({ x: 0, y: 0 }), anchor({ x: s, y: 0 }), anchor({ x: s, y: s }), anchor({ x: 0, y: s })],
});
const pathOf = (doc: ReturnType<typeof makeDocument>, id: string) => Query.getItem(doc, id) as PathItem;
const pts = (g: PathItem) => g.geometry.anchors.map((a) => ({ x: Math.round(a.point.x * 100) / 100, y: Math.round(a.point.y * 100) / 100 }));

describe("ops.scribble.scribble", () => {
  it("hatches a square into one open boustrophedon path at angle 0", () => {
    const doc = makeDocument();
    const p = makePath(square(100), { fill: solid(RED) });
    Ops.Items.addItem(doc, p);
    const ids = Ops.Scribble.scribble(doc, [p.id], { angle: 0, spacing: 20, strokeWidth: 2 });
    expect(ids).toEqual([p.id]);
    const it = pathOf(doc, p.id);
    expect(it.geometry.closed).toBe(false); // an open scribble line
    expect(pts(it)).toEqual([
      { x: 0, y: 10 }, { x: 100, y: 10 }, // line 0 → forward
      { x: 100, y: 30 }, { x: 0, y: 30 }, // line 1 → reverse
      { x: 0, y: 50 }, { x: 100, y: 50 },
      { x: 100, y: 70 }, { x: 0, y: 70 },
      { x: 0, y: 90 }, { x: 100, y: 90 },
    ]);
  });

  it("strokes the scribble in the former fill colour and drops the fill", () => {
    const doc = makeDocument();
    const p = makePath(square(100), { fill: solid(RED) });
    Ops.Items.addItem(doc, p);
    Ops.Scribble.scribble(doc, [p.id], { angle: 0, spacing: 20, strokeWidth: 3 });
    const it = pathOf(doc, p.id);
    expect(it.fill.type).toBe("none"); // fill replaced by the scribble
    expect(it.stroke.paint.type === "solid" ? it.stroke.paint.color : null).toEqual({ r: 220, g: 0, b: 0, a: 1 });
    expect(it.stroke.width).toBe(3);
  });

  it("produces a separate segment per region across a gap (even-odd compound)", () => {
    // two side-by-side squares as one compound: a scanline crosses BOTH → 2 segments.
    const doc = makeDocument();
    const left = { closed: true, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 40, y: 0 }), anchor({ x: 40, y: 100 }), anchor({ x: 0, y: 100 })] };
    const right = { closed: true, anchors: [anchor({ x: 60, y: 0 }), anchor({ x: 100, y: 0 }), anchor({ x: 100, y: 100 }), anchor({ x: 60, y: 100 })] };
    const c = makeCompound([left, right], { fill: solid(RED) });
    Ops.Items.addItem(doc, c);
    Ops.Scribble.scribble(doc, [c.id], { angle: 0, spacing: 20, strokeWidth: 2 });
    const it = pathOf(doc, c.id);
    expect(it.type).toBe("path"); // the compound becomes one open scribble path
    // line 0 (y=10) crosses both squares → 4 points: (0,10)(40,10)(60,10)(100,10).
    const line0 = pts(it).slice(0, 4);
    expect(line0).toEqual([{ x: 0, y: 10 }, { x: 40, y: 10 }, { x: 60, y: 10 }, { x: 100, y: 10 }]);
  });

  it("respects a hole (even-odd): the hatch skips the interior of a donut", () => {
    // outer 0..100 with a 25..75 square hole. At y=50 the scanline must produce
    // TWO segments [0,25] and [75,100], skipping the hole interior 25..75.
    const doc = makeDocument();
    const outer = square(100);
    const hole = { closed: true, anchors: [anchor({ x: 25, y: 25 }), anchor({ x: 75, y: 25 }), anchor({ x: 75, y: 75 }), anchor({ x: 25, y: 75 })] };
    const c = makeCompound([outer, hole], { fill: solid(RED) });
    Ops.Items.addItem(doc, c);
    Ops.Scribble.scribble(doc, [c.id], { angle: 0, spacing: 20, strokeWidth: 2 });
    const at50 = pts(pathOf(doc, c.id))
      .filter((p) => p.y === 50)
      .map((p) => p.x)
      .sort((a, b) => a - b);
    expect(at50).toEqual([0, 25, 75, 100]); // no point in the hole interior (25..75)
    const at10 = pts(pathOf(doc, c.id))
      .filter((p) => p.y === 10)
      .map((p) => p.x)
      .sort((a, b) => a - b);
    expect(at10).toEqual([0, 100]); // above the hole → one full-width segment
  });

  it("hatches a curved (bezier) shape, staying within its bounds", () => {
    const k = 27.6; // ≈ KAPPA·r for a circle of radius 50
    const circle = {
      closed: true,
      anchors: [
        anchor({ x: 50, y: 0 }, { x: -k, y: 0 }, { x: k, y: 0 }),
        anchor({ x: 100, y: 50 }, { x: 0, y: -k }, { x: 0, y: k }),
        anchor({ x: 50, y: 100 }, { x: k, y: 0 }, { x: -k, y: 0 }),
        anchor({ x: 0, y: 50 }, { x: 0, y: k }, { x: 0, y: -k }),
      ],
    };
    const doc = makeDocument();
    const p = makePath(circle, { fill: solid(RED) });
    Ops.Items.addItem(doc, p);
    Ops.Scribble.scribble(doc, [p.id], { angle: 0, spacing: 15, strokeWidth: 2 });
    const it = pathOf(doc, p.id);
    expect(it.geometry.closed).toBe(false);
    expect(it.geometry.anchors.length).toBeGreaterThan(2);
    for (const { point } of it.geometry.anchors) {
      expect(point.x).toBeGreaterThanOrEqual(-1);
      expect(point.x).toBeLessThanOrEqual(101);
      expect(point.y).toBeGreaterThanOrEqual(-1);
      expect(point.y).toBeLessThanOrEqual(101);
    }
  });

  it("converts a live rect before scribbling it", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 100, 100, 0, 0, { fill: solid(RED) });
    Ops.Items.addItem(doc, r);
    Ops.Scribble.scribble(doc, [r.id], { angle: 0, spacing: 20, strokeWidth: 2 });
    expect(Query.getItem(doc, r.id)!.type).toBe("path");
    expect((Query.getItem(doc, r.id) as PathItem).geometry.closed).toBe(false);
  });

  it("scribbles a live shape whose fill exists only in its appearance stack", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 100, 100, 0, 0, { fill: noPaint() });
    Ops.Items.addItem(doc, r);
    Ops.Appearance.addFill(doc, [r.id], solid(RED));
    r.fill = noPaint(); // stale legacy primary, as in older saved documents

    expect(Ops.Scribble.scribble(doc, [r.id], { angle: 0, spacing: 20, strokeWidth: 2 })).toEqual([r.id]);
    expect(pathOf(doc, r.id).stroke.paint).toEqual(solid(RED));
  });

  it("is a no-op for an unfilled shape", () => {
    const doc = makeDocument();
    const p = makePath(square(100), { fill: noPaint(), stroke: defaultStroke(solid(RED)) });
    Ops.Items.addItem(doc, p);
    expect(Ops.Scribble.scribble(doc, [p.id], { angle: 0, spacing: 20, strokeWidth: 2 })).toEqual([]);
    expect((Query.getItem(doc, p.id) as PathItem).geometry.closed).toBe(true); // unchanged
  });

  it("does not flatten an unfilled live shape on a refused scribble", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 100, 100, 0, 0, { fill: noPaint() });
    Ops.Items.addItem(doc, r);
    expect(Ops.Scribble.scribble(doc, [r.id], { angle: 0, spacing: 20, strokeWidth: 2 })).toEqual([]);
    expect(Query.getItem(doc, r.id)!.type).toBe("rect");
  });

  it("is a safe no-op when the spacing is larger than the shape (no hatch lines)", () => {
    const doc = makeDocument();
    const p = makePath(square(100), { fill: solid(RED) });
    Ops.Items.addItem(doc, p);
    expect(() => Ops.Scribble.scribble(doc, [p.id], { angle: 0, spacing: 500, strokeWidth: 2 })).not.toThrow();
    expect(Ops.Scribble.scribble(doc, [p.id], { angle: 0, spacing: 500, strokeWidth: 2 })).toEqual([]);
    expect(pathOf(doc, p.id).geometry.closed).toBe(true); // left as the filled square
  });

  it("carries the source opacity and blend mode onto the scribble", () => {
    const doc = makeDocument();
    const p = makePath(square(100), { fill: solid(RED) });
    p.opacity = 0.5;
    p.blendMode = "multiply";
    Ops.Items.addItem(doc, p);
    Ops.Scribble.scribble(doc, [p.id], { angle: 0, spacing: 20, strokeWidth: 2 });
    const it = pathOf(doc, p.id);
    expect(it.opacity).toBe(0.5);
    expect(it.blendMode).toBe("multiply");
  });

  it("hatches at an angle — all points stay within the shape's bounds", () => {
    const doc = makeDocument();
    const p = makePath(square(100), { fill: solid(RED) });
    Ops.Items.addItem(doc, p);
    Ops.Scribble.scribble(doc, [p.id], { angle: 45, spacing: 15, strokeWidth: 2 });
    const a = pathOf(doc, p.id).geometry.anchors;
    expect(a.length).toBeGreaterThan(2);
    for (const { point } of a) {
      expect(point.x).toBeGreaterThanOrEqual(-0.01);
      expect(point.x).toBeLessThanOrEqual(100.01);
      expect(point.y).toBeGreaterThanOrEqual(-0.01);
      expect(point.y).toBeLessThanOrEqual(100.01);
    }
  });
});
