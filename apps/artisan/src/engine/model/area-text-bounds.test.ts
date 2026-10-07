// ─────────────────────────────────────────────────────────────
// model/area-text-bounds.test — area type's box origin is its TOP-LEFT
// ─────────────────────────────────────────────────────────────
// Point text sits on its baseline, so its bounds start one ascent ABOVE the
// item origin. An area-type box does not: the renderer places its foreignObject
// at local (0,0)…(boxWidth,boxHeight). Offsetting an area-type box by the
// ascent too puts the selection rectangle, the transform handles, align/
// distribute and hit-testing all one ascent above the painted text.

import { describe, it, expect } from "vitest";
import { makeDocument, makeText, Mat, Ops, Query, Shapes } from "../index";

describe("estimateTextBounds", () => {
  it("keeps point text on its baseline (bounds start one ascent above the origin)", () => {
    const t = makeText("Hello", 0, 0, { fontSize: 20 });
    expect(Shapes.estimateTextBounds(t).y).toBeCloseTo(-16, 6); // −0.8 × 20
  });

  it("puts an area-type box's top edge AT the item origin", () => {
    const t = makeText("Hello", 0, 0, { fontSize: 18 });
    t.boxWidth = 200;
    t.boxHeight = 100;
    const b = Shapes.estimateTextBounds(t);
    expect(b.y).toBe(0);
    expect(b.height).toBe(100);
  });

  it("an area-type object's world bounds match the box the renderer paints", () => {
    const doc = makeDocument();
    const t = makeText("Area text", 0, 0, { fontSize: 18 });
    t.transform = Mat.translation(100, 100);
    t.boxWidth = 200;
    t.boxHeight = 100;
    Ops.Items.addItem(doc, t);

    // The renderer draws foreignObject x=0,y=0,w=boxWidth,h=boxHeight under the
    // item transform, i.e. world (100,100)…(300,200).
    expect(Query.worldBounds(doc, t.id)).toMatchObject({ x: 100, y: 100, width: 200, height: 100 });
  });

  it("hit-testing matches the painted box, not a box shifted up by the ascent", () => {
    const doc = makeDocument();
    const t = makeText("Area text", 0, 0, { fontSize: 18 });
    t.transform = Mat.translation(100, 100);
    t.boxWidth = 200;
    t.boxHeight = 100;
    Ops.Items.addItem(doc, t);

    expect(Query.hitTest(doc, { x: 150, y: 197 }, 6)).toBeTruthy(); // inside the bottom edge
    expect(Query.hitTest(doc, { x: 150, y: 90 }, 6)).toBeFalsy(); // above the box, over empty canvas
  });
});
