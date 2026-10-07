// ─────────────────────────────────────────────────────────────
// model/used-colors.test — Query.usedColorsNotInSwatches (Add Used Colors)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Swatches ▸ "Add Used Colors" — collect the solid
// colours the artwork uses that aren't already swatches. Fills, strokes, and
// text-run fills, de-duplicated by value, in first-seen order; non-solids skipped.

import { describe, it, expect } from "vitest";
import { makeDocument, makeRect, makeGroup, solid, rgba, Query } from "../index";
import type { Paint } from "../index";

const RED = rgba(200, 30, 40, 1);
const GREEN = rgba(20, 150, 60, 1);
const BLUE = rgba(30, 60, 200, 1);

const rectWith = (fill: Paint, strokePaint: Paint) => {
  const r = makeRect(0, 0, 10, 10, 0, 0, { fill });
  r.stroke = { ...r.stroke, paint: strokePaint };
  return r;
};
const solidColors = (ps: Paint[]) => ps.map((p) => (p.type === "solid" ? p.color : null));

const setup = () => {
  const doc = makeDocument();
  doc.swatches = []; // start from a clean library so the assertions are exact
  const a = rectWith(solid(RED), solid(GREEN));
  const b = rectWith(solid(BLUE), solid(RED)); // stroke RED duplicates A's fill
  const c = rectWith({ type: "none" }, { type: "none" }); // contributes nothing
  doc.layers[0].items.push(a, b, c);
  return doc;
};

describe("Query.usedColorsNotInSwatches", () => {
  it("collects used solid colours in first-seen order, de-duplicated, skipping non-solids", () => {
    const doc = setup();
    // A.fill RED, A.stroke GREEN, B.fill BLUE, (B.stroke RED dup), C none skipped
    expect(solidColors(Query.usedColorsNotInSwatches(doc))).toEqual([RED, GREEN, BLUE]);
  });

  it("excludes colours already present in the swatch library", () => {
    const doc = setup();
    doc.swatches = [solid(RED)];
    expect(solidColors(Query.usedColorsNotInSwatches(doc))).toEqual([GREEN, BLUE]);
  });

  it("returns [] when every used colour is already a swatch", () => {
    const doc = setup();
    doc.swatches = [solid(RED), solid(GREEN), solid(BLUE)];
    expect(Query.usedColorsNotInSwatches(doc)).toEqual([]);
  });

  it("collects colours of leaves nested inside a group (skips the container itself)", () => {
    const doc = makeDocument();
    doc.swatches = [];
    const child = rectWith(solid(BLUE), { type: "none" });
    doc.layers[0].items.push(makeGroup([child]));
    expect(solidColors(Query.usedColorsNotInSwatches(doc))).toEqual([BLUE]); // the group adds no paint of its own
  });

  it("returns [] for a document with no artwork", () => {
    expect(Query.usedColorsNotInSwatches(makeDocument())).toEqual([]);
  });
});
