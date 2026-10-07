// ─────────────────────────────────────────────────────────────
// ops/reverse-gradient.test — Gradient panel "Reverse" (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator's Gradient panel Reverse button — flips the stop
// order so the colours run the other way (offset → 1 − offset), flipping the
// per-stop midpoint too.

import { describe, it, expect } from "vitest";
import { makeDocument, makeRect, makeGroup, linearGradient, Ops, Query, solid, defaultStroke, rgba } from "../index";
import type { GradientStop } from "../index";

const RED = rgba(220, 0, 0, 1);
const GREEN = rgba(0, 200, 0, 1);
const BLUE = rgba(0, 0, 220, 1);
const YELLOW = rgba(220, 220, 0, 1);
const grad = (stops: GradientStop[]) => {
  const p = linearGradient();
  if (p.type !== "gradient") throw new Error("expected gradient");
  p.gradient.stops = stops;
  return p;
};
const fillStops = (doc: ReturnType<typeof makeDocument>, id: string) => {
  const f = Query.getItem(doc, id)!.fill;
  return f.type === "gradient" ? f.gradient.stops : null;
};

describe("ops.paint.reverseGradient", () => {
  it("mirrors a two-stop gradient: colours swap ends", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 10, 10, 0, 0, { fill: grad([{ offset: 0, color: RED }, { offset: 1, color: BLUE }]) });
    Ops.Items.addItem(doc, r);
    expect(Ops.Paint.reverseGradient(doc, [r.id])).toEqual([r.id]);
    expect(fillStops(doc, r.id)).toEqual([
      { offset: 0, color: BLUE }, // blue now at the start
      { offset: 1, color: RED },
    ]);
  });

  it("reverses a three-stop gradient, keeping the middle offset and flipping the midpoint", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 10, 10, 0, 0, {
      fill: grad([
        { offset: 0, color: RED, midpoint: 0.3 }, // bias toward GREEN
        { offset: 0.5, color: GREEN },
        { offset: 1, color: BLUE },
      ]),
    });
    Ops.Items.addItem(doc, r);
    Ops.Paint.reverseGradient(doc, [r.id]);
    expect(fillStops(doc, r.id)).toEqual([
      { offset: 0, color: BLUE }, // BLUE→GREEN segment has no original midpoint
      { offset: 0.5, color: GREEN, midpoint: 0.7 }, // flipped midpoint (1 − 0.3) now biases GREEN→RED
      { offset: 1, color: RED },
    ]);
  });

  it("reverses a gradient STROKE too", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 10, 10, 0, 0, {
      fill: solid(RED),
      stroke: { ...defaultStroke(grad([{ offset: 0, color: RED }, { offset: 1, color: BLUE }])), width: 2 },
    });
    Ops.Items.addItem(doc, r);
    Ops.Paint.reverseGradient(doc, [r.id]);
    const sp = Query.getItem(doc, r.id)!.stroke.paint;
    expect(sp.type === "gradient" ? sp.gradient.stops[0].color : null).toEqual(BLUE);
  });

  it("is a no-op for a solid-filled object", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 10, 10, 0, 0, { fill: solid(RED) });
    Ops.Items.addItem(doc, r);
    expect(Ops.Paint.reverseGradient(doc, [r.id])).toEqual([]);
    const f = Query.getItem(doc, r.id)!.fill;
    expect(f.type === "solid" ? f.color : null).toEqual(RED); // unchanged
  });

  it("recurses into a selected GROUP, reversing its children's gradients", () => {
    const doc = makeDocument();
    const a = makeRect(0, 0, 10, 10, 0, 0, { fill: grad([{ offset: 0, color: RED }, { offset: 1, color: BLUE }]) });
    const b = makeRect(20, 0, 10, 10, 0, 0, { fill: grad([{ offset: 0, color: RED }, { offset: 1, color: BLUE }]) });
    const g = makeGroup([a, b]);
    Ops.Items.addItem(doc, g);
    expect(new Set(Ops.Paint.reverseGradient(doc, [g.id]))).toEqual(new Set([a.id, b.id])); // leaf ids
    expect(fillStops(doc, a.id)![0].color).toEqual(BLUE);
    expect(fillStops(doc, b.id)![0].color).toEqual(BLUE);
  });

  it("reverses both a gradient fill and a gradient stroke in one call (id returned once)", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 10, 10, 0, 0, {
      fill: grad([{ offset: 0, color: RED }, { offset: 1, color: BLUE }]),
      stroke: { ...defaultStroke(grad([{ offset: 0, color: GREEN }, { offset: 1, color: YELLOW }])), width: 2 },
    });
    Ops.Items.addItem(doc, r);
    expect(Ops.Paint.reverseGradient(doc, [r.id])).toEqual([r.id]); // id appears once
    expect(fillStops(doc, r.id)![0].color).toEqual(BLUE);
    const sp = Query.getItem(doc, r.id)!.stroke.paint;
    expect(sp.type === "gradient" ? sp.gradient.stops[0].color : null).toEqual(YELLOW);
  });

  it("preserves the gradient geometry (axis + spread) — only the stops change", () => {
    const doc = makeDocument();
    const p = grad([{ offset: 0, color: RED }, { offset: 1, color: BLUE }]);
    if (p.type !== "gradient") throw new Error("expected gradient");
    Object.assign(p.gradient, { x1: 0.2, y1: 0.3, x2: 0.9, y2: 0.1, spread: "reflect" });
    const r = makeRect(0, 0, 10, 10, 0, 0, { fill: p });
    Ops.Items.addItem(doc, r);
    Ops.Paint.reverseGradient(doc, [r.id]);
    const f = Query.getItem(doc, r.id)!.fill;
    if (f.type !== "gradient") throw new Error("expected gradient");
    expect([f.gradient.x1, f.gradient.y1, f.gradient.x2, f.gradient.y2, f.gradient.spread]).toEqual([0.2, 0.3, 0.9, 0.1, "reflect"]);
  });

  it("handles degenerate inputs: a 1-stop gradient and no/missing targets", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 10, 10, 0, 0, { fill: grad([{ offset: 0.4, color: RED }]) });
    Ops.Items.addItem(doc, r);
    expect(() => Ops.Paint.reverseGradient(doc, [r.id])).not.toThrow();
    expect(fillStops(doc, r.id)).toEqual([{ offset: 0.6, color: RED }]); // single stop mirrored, no crash
    expect(Ops.Paint.reverseGradient(doc, [])).toEqual([]); // no ids
    expect(Ops.Paint.reverseGradient(doc, ["nope"])).toEqual([]); // missing id
  });

  it("reversing twice restores the original gradient", () => {
    const doc = makeDocument();
    const original: GradientStop[] = [{ offset: 0, color: RED }, { offset: 0.5, color: GREEN }, { offset: 1, color: BLUE }];
    const r = makeRect(0, 0, 10, 10, 0, 0, { fill: grad(original.map((s) => ({ ...s }))) });
    Ops.Items.addItem(doc, r);
    Ops.Paint.reverseGradient(doc, [r.id]);
    Ops.Paint.reverseGradient(doc, [r.id]);
    expect(fillStops(doc, r.id)).toEqual(original); // an involution (offsets round-trip exactly)
  });
});
