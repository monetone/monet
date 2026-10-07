// ─────────────────────────────────────────────────────────────
// ops/swap-fill-stroke.test — swap fill ↔ stroke paint (Shift+X)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator "Swap Fill and Stroke" (Shift+X) exchanges the
// fill and stroke COLOURS, keeping the stroke weight/attributes.

import { describe, it, expect } from "vitest";
import { makeDocument, makeRect, makeGroup, Ops, Query, solid, defaultStroke, rgba } from "../index";

const RED = rgba(220, 0, 0);
const BLUE = rgba(0, 0, 220);

describe("ops.paint.swapFillStroke", () => {
  it("exchanges the fill and stroke paint on each selected object", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(RED), stroke: defaultStroke(solid(BLUE)) });
    Ops.Items.addItem(doc, r);
    Ops.Paint.swapFillStroke(doc, [r.id]);
    expect(Query.getItem(doc, r.id)!.fill).toEqual(solid(BLUE));
    expect(Query.getItem(doc, r.id)!.stroke.paint).toEqual(solid(RED));
  });

  it("keeps the stroke weight while swapping only the paint", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(RED), stroke: { ...defaultStroke(solid(BLUE)), width: 7 } });
    Ops.Items.addItem(doc, r);
    Ops.Paint.swapFillStroke(doc, [r.id]);
    expect(Query.getItem(doc, r.id)!.stroke.width).toBe(7);
    expect(Query.getItem(doc, r.id)!.stroke.paint).toEqual(solid(RED));
  });

  it("recurses into groups", () => {
    const doc = makeDocument();
    const child = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(RED), stroke: defaultStroke(solid(BLUE)) });
    Ops.Items.addItem(doc, makeGroup([child]));
    Ops.Paint.swapFillStroke(doc, [child.id]);
    expect(Query.getItem(doc, child.id)!.fill).toEqual(solid(BLUE));
    expect(Query.getItem(doc, child.id)!.stroke.paint).toEqual(solid(RED));
  });

  it("swaps the visible appearance fill and stroke", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(RED) });
    r.appearance = {
      entries: [
        { id: "hidden-fill", kind: "fill", paint: solid(RED), visible: false },
        { id: "visible-fill", kind: "fill", paint: solid(BLUE) },
        { id: "visible-stroke", kind: "stroke", stroke: { ...defaultStroke(solid(RED)), width: 7 } },
      ],
    };
    Ops.Items.addItem(doc, r);

    Ops.Paint.swapFillStroke(doc, [r.id]);

    expect(r.appearance.entries[1]).toMatchObject({ kind: "fill", paint: solid(RED) });
    expect(r.appearance.entries[2]).toMatchObject({ kind: "stroke", stroke: { paint: solid(BLUE), width: 7 } });
  });
});
