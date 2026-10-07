// ─────────────────────────────────────────────────────────────
// ops/blend-colors.test — Edit ▸ Edit Colors ▸ Blend … (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Edit Colors Blend Front to Back / Horizontally /
// Vertically — the two end objects keep their colours; the middle objects are
// interpolated across stacking order (front-to-back) or position (h / v).

import { describe, it, expect } from "vitest";
import { makeDocument, makeRect, Ops, paintedFill, Query, solid, linearGradient, rgba } from "../index";

const RED = rgba(220, 0, 0);
const BLUE = rgba(0, 0, 220);
const fill = (doc: ReturnType<typeof makeDocument>, id: string) => {
  const f = Query.getItem(doc, id)!.fill;
  return f.type === "solid" ? f.color : null;
};

describe("ops.blend-colors.blendColors", () => {
  it("blends front-to-back by stacking order, keeping the ends", () => {
    const doc = makeDocument();
    const back = makeRect(0, 0, 10, 10, 0, 0, { fill: solid(RED) }); // added first ⇒ bottom
    const mid = makeRect(0, 0, 10, 10, 0, 0, { fill: solid(rgba(0, 255, 0)) });
    const front = makeRect(0, 0, 10, 10, 0, 0, { fill: solid(BLUE) }); // top
    Ops.Items.addItem(doc, back);
    Ops.Items.addItem(doc, mid);
    Ops.Items.addItem(doc, front);

    const ids = Ops.BlendColors.blendColors(doc, [back.id, mid.id, front.id], "front-to-back");
    expect(ids).toHaveLength(3);
    expect(fill(doc, back.id)).toEqual(RED); // back end unchanged
    expect(fill(doc, front.id)).toEqual(BLUE); // front end unchanged
    expect(fill(doc, mid.id)).toEqual({ r: 110, g: 0, b: 110, a: 1 }); // 50/50 red↔blue
  });

  it("blends horizontally by x position (independent of z-order)", () => {
    const doc = makeDocument();
    // stacking order scrambled relative to x; the blend must use x position
    const rightBlue = makeRect(100, 0, 10, 10, 0, 0, { fill: solid(BLUE) }); // x centre 105
    const leftRed = makeRect(0, 0, 10, 10, 0, 0, { fill: solid(RED) }); // x centre 5
    const midGreen = makeRect(50, 0, 10, 10, 0, 0, { fill: solid(rgba(0, 255, 0)) }); // x centre 55
    Ops.Items.addItem(doc, rightBlue);
    Ops.Items.addItem(doc, leftRed);
    Ops.Items.addItem(doc, midGreen);

    Ops.BlendColors.blendColors(doc, [rightBlue.id, leftRed.id, midGreen.id], "horizontal");
    expect(fill(doc, leftRed.id)).toEqual(RED); // left end kept
    expect(fill(doc, rightBlue.id)).toEqual(BLUE); // right end kept
    // mid centre x=55, t = (55−5)/(105−5) = 0.5 → 50/50 red↔blue
    expect(fill(doc, midGreen.id)).toEqual({ r: 110, g: 0, b: 110, a: 1 });
  });

  it("interpolates by actual (uneven) spacing", () => {
    const doc = makeDocument();
    const a = makeRect(0, 0, 10, 10, 0, 0, { fill: solid(RED) }); // centre 5
    const b = makeRect(10, 0, 10, 10, 0, 0, { fill: solid(rgba(0, 255, 0)) }); // centre 15
    const c = makeRect(90, 0, 10, 10, 0, 0, { fill: solid(BLUE) }); // centre 95
    Ops.Items.addItem(doc, a);
    Ops.Items.addItem(doc, b);
    Ops.Items.addItem(doc, c);
    Ops.BlendColors.blendColors(doc, [a.id, b.id, c.id], "horizontal");
    // b: t = (15−5)/(95−5) = 1/9 → red·(8/9) + blue·(1/9)
    expect(fill(doc, b.id)).toEqual({ r: 220 - (220 * 1) / 9, g: 0, b: (220 * 1) / 9, a: 1 });
  });

  it("blends vertically by y position", () => {
    const doc = makeDocument();
    const top = makeRect(0, 0, 10, 10, 0, 0, { fill: solid(RED) }); // y centre 5
    const mid = makeRect(0, 50, 10, 10, 0, 0, { fill: solid(rgba(0, 255, 0)) }); // y centre 55
    const bot = makeRect(0, 100, 10, 10, 0, 0, { fill: solid(BLUE) }); // y centre 105
    Ops.Items.addItem(doc, top);
    Ops.Items.addItem(doc, mid);
    Ops.Items.addItem(doc, bot);
    Ops.BlendColors.blendColors(doc, [top.id, mid.id, bot.id], "vertical");
    expect(fill(doc, mid.id)).toEqual({ r: 110, g: 0, b: 110, a: 1 });
  });

  it("needs ≥3 solidly-filled objects", () => {
    const doc = makeDocument();
    const a = makeRect(0, 0, 10, 10, 0, 0, { fill: solid(RED) });
    const b = makeRect(50, 0, 10, 10, 0, 0, { fill: solid(BLUE) });
    const grad = makeRect(100, 0, 10, 10, 0, 0, { fill: linearGradient() }); // not solid
    Ops.Items.addItem(doc, a);
    Ops.Items.addItem(doc, b);
    Ops.Items.addItem(doc, grad);
    // only 2 solid ⇒ no blend
    expect(Ops.BlendColors.blendColors(doc, [a.id, b.id, grad.id], "horizontal")).toEqual([]);
    expect(fill(doc, a.id)).toEqual(RED); // unchanged
  });

  it("reads and writes the visible fill in an appearance stack", () => {
    const doc = makeDocument();
    const items = [RED, rgba(0, 255, 0), BLUE].map((color, x) => {
      const item = makeRect(x * 50, 0, 10, 10, 0, 0, { fill: solid(color) });
      item.appearance = { entries: [{ id: `fill-${x}`, kind: "fill", paint: solid(color) }] };
      return item;
    });
    Ops.Items.addItems(doc, items);

    Ops.BlendColors.blendColors(doc, items.map((item) => item.id), "horizontal");

    expect(paintedFill(items[1])).toEqual(solid(rgba(110, 0, 110)));
  });
});
