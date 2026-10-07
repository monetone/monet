// ─────────────────────────────────────────────────────────────
// ops/convert-shape.test — Object ▸ Convert to Shape (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Convert to Shape — replaces each object with a
// Rectangle / Rounded Rectangle / Ellipse fitting its bounding box (plus optional
// extra width/height), centred on the object and keeping its fill/stroke.

import { describe, it, expect } from "vitest";
import { makeDocument, makeGroup, makeImage, makeRect, makePath, makeText, makeAnchor as anchor, Ops, Query, solid, rgba } from "../index";
import type { RectItem } from "../index";

const RED = rgba(220, 0, 0);
const triangle = () => ({
  closed: true,
  anchors: [anchor({ x: 10, y: 10 }), anchor({ x: 110, y: 10 }), anchor({ x: 60, y: 110 })],
});
const box = (doc: ReturnType<typeof makeDocument>, id: string) => Query.worldBounds(doc, id)!;

describe("ops.convert-shape.convertToShape", () => {
  it("converts a path to an ellipse fitting its bounds, keeping fill", () => {
    const doc = makeDocument();
    const p = makePath(triangle(), { fill: solid(RED) }); // bbox 10,10..110,110
    Ops.Items.addItem(doc, p);

    const ids = Ops.ConvertShape.convertToShape(doc, [p.id], "ellipse");
    expect(ids).toHaveLength(1);
    const it = Query.getItem(doc, ids[0])!;
    expect(it.type).toBe("ellipse");
    expect(it.fill).toEqual(solid(RED));
    const b = box(doc, ids[0]);
    expect([b.x, b.y, b.width, b.height]).toEqual([10, 10, 100, 100]); // same bbox
    expect(Query.getItem(doc, p.id)).toBeNull(); // original replaced
  });

  it("converts to a plain rectangle (no corner radius)", () => {
    const doc = makeDocument();
    const p = makePath(triangle(), { fill: solid(RED) });
    Ops.Items.addItem(doc, p);
    const it = Query.getItem(doc, Ops.ConvertShape.convertToShape(doc, [p.id], "rectangle")[0])! as RectItem;
    expect(it.type).toBe("rect");
    expect(it.rx).toBe(0);
    expect(it.ry).toBe(0);
  });

  it("converts to a rounded rectangle with the given corner radius", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 100, 80, 0, 0, { fill: solid(RED) });
    Ops.Items.addItem(doc, r);
    const it = Query.getItem(doc, Ops.ConvertShape.convertToShape(doc, [r.id], "rounded-rectangle", { cornerRadius: 15 })[0])! as RectItem;
    expect(it.type).toBe("rect");
    expect(it.rx).toBe(15);
    expect(it.ry).toBe(15);
  });

  it("clamps the corner radius to half the shorter side", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 100, 40, 0, 0, { fill: solid(RED) });
    Ops.Items.addItem(doc, r);
    const it = Query.getItem(doc, Ops.ConvertShape.convertToShape(doc, [r.id], "rounded-rectangle", { cornerRadius: 1000 })[0])! as RectItem;
    expect(it.rx).toBe(20); // min(1000, 100/2, 40/2)
  });

  it("grows the shape by extra width/height, centred on the bounds", () => {
    const doc = makeDocument();
    const r = makeRect(50, 50, 100, 100, 0, 0, { fill: solid(RED) }); // bbox 50,50..150,150, centre (100,100)
    Ops.Items.addItem(doc, r);
    const it = Query.getItem(doc, Ops.ConvertShape.convertToShape(doc, [r.id], "ellipse", { extraWidth: 20, extraHeight: 40 })[0])!;
    const b = box(doc, it.id);
    // 120×140 centred on (100,100)
    expect([b.x, b.y, b.width, b.height]).toEqual([40, 30, 120, 140]);
  });

  it("preserves non-geometric item state", () => {
    const doc = makeDocument();
    const p = makePath(triangle(), { fill: solid(RED) });
    p.visible = false;
    p.locked = true;
    p.appearance = { entries: [{ id: "fill", kind: "fill", paint: solid(rgba(0, 0, 220)) }] };
    p.effects = [{ type: "blur", radius: 3 }];
    p.overprintFill = true;
    p.overprintStroke = true;
    p.evenOdd = true;
    p.mask = [makeRect(0, 0, 5, 5)];
    p.maskType = "alpha";
    p.brush = {
      brushId: "brush",
      brushName: "Brush",
      kind: "calligraphic",
      settings: { size: 4, angle: 0, roundness: 1, paintSource: "stroke" },
    };
    Ops.Items.addItem(doc, p);

    const next = Query.getItem(doc, Ops.ConvertShape.convertToShape(doc, [p.id], "ellipse")[0])!;

    expect(next).toMatchObject({
      visible: false,
      locked: true,
      appearance: p.appearance,
      effects: p.effects,
      overprintFill: true,
      overprintStroke: true,
      evenOdd: true,
      maskType: "alpha",
      brush: p.brush,
    });
    expect(next.mask).toEqual(p.mask);
    expect(next.appearance).not.toBe(p.appearance);
  });

  it("converts groups, text and images using their existing local bounds", () => {
    for (const item of [
      makeGroup([makeRect(10, 20, 30, 40)]),
      makeText("Hi", 10, 20),
      makeImage("data:image/png;base64,AA==", 10, 20, 30, 40),
    ]) {
      const doc = makeDocument();
      Ops.Items.addItem(doc, item);
      const before = box(doc, item.id);

      const result = Ops.ConvertShape.convertToShape(doc, [item.id], "ellipse");

      expect(result).toHaveLength(1);
      expect(Query.getItem(doc, result[0])!.type).toBe("ellipse");
      expect(box(doc, result[0])).toEqual(before);
    }
  });
});
