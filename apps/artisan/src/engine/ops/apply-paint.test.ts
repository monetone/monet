// ─────────────────────────────────────────────────────────────
// ops/apply-paint.test — applyFill / applyStrokePaint (Swatches/Color apply)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator — clicking a swatch (or colour) applies it to the
// selected objects' fill or stroke. The op recurses into groups so every leaf
// takes the colour, and deep-copies the paint so objects don't share a reference.

import { describe, it, expect } from "vitest";
import { makeDocument, makeRect, makeGroup, Ops, Query, solid, rgba, type Paint } from "../index";

const RED = rgba(220, 0, 0);
const BLUE = rgba(0, 0, 220);
const colorOf = (p: Paint) => (p.type === "solid" ? p.color : null);

describe("ops.paint.applyFill / applyStrokePaint", () => {
  it("applyFill sets the fill on every selected object", () => {
    const doc = makeDocument();
    const a = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(RED) });
    const b = makeRect(50, 0, 40, 40, 0, 0, { fill: solid(RED) });
    Ops.Items.addItem(doc, a);
    Ops.Items.addItem(doc, b);
    Ops.Paint.applyFill(doc, [a.id, b.id], solid(BLUE));
    expect(Query.getItem(doc, a.id)!.fill).toEqual(solid(BLUE));
    expect(Query.getItem(doc, b.id)!.fill).toEqual(solid(BLUE));
  });

  it("applyFill recurses into groups — every leaf takes the colour", () => {
    const doc = makeDocument();
    const child = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(RED) });
    Ops.Items.addItem(doc, makeGroup([child]));
    Ops.Paint.applyFill(doc, [child.id], solid(BLUE)); // via the group → leaf
    expect(Query.getItem(doc, child.id)!.fill).toEqual(solid(BLUE));
  });

  it("applyStrokePaint sets the stroke paint, leaving the fill alone", () => {
    const doc = makeDocument();
    const a = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(RED) });
    Ops.Items.addItem(doc, a);
    Ops.Paint.applyStrokePaint(doc, [a.id], solid(BLUE));
    expect(Query.getItem(doc, a.id)!.stroke.paint).toEqual(solid(BLUE));
    expect(Query.getItem(doc, a.id)!.fill).toEqual(solid(RED));
  });

  it("deep-copies the paint so objects don't share a reference", () => {
    const doc = makeDocument();
    const a = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(RED) });
    const b = makeRect(50, 0, 40, 40, 0, 0, { fill: solid(RED) });
    Ops.Items.addItem(doc, a);
    Ops.Items.addItem(doc, b);
    Ops.Paint.applyFill(doc, [a.id, b.id], solid(BLUE));
    colorOf(Query.getItem(doc, a.id)!.fill)!.r = 99; // mutate a's colour
    expect(colorOf(Query.getItem(doc, b.id)!.fill)!.r).toBe(0); // b unaffected (BLUE.r)
  });
});
