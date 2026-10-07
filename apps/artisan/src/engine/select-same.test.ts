// ─────────────────────────────────────────────────────────────
// select-same.test — Select ▸ Same (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator "Select ▸ Same" — selects every object in the
// document that matches the reference object's attribute (Fill Color, Stroke
// Color, Stroke Weight, Opacity, …). The reference itself is included.

import { describe, it, expect } from "vitest";
import { makeDocument, makeLayer, makeRect, makeText, makeGroup, Ops, Query, solid, noPaint, defaultStroke, rgba } from "./index";

const RED = rgba(220, 0, 0);
const BLUE = rgba(0, 0, 220);
const BLACK = rgba(0, 0, 0);

const mk = (fill: ReturnType<typeof rgba>, strokePaint: ReturnType<typeof solid> | ReturnType<typeof noPaint>, width: number, opacity: number) =>
  makeRect(0, 0, 10, 10, 0, 0, { fill: solid(fill), stroke: { ...defaultStroke(strokePaint), width }, opacity });

const same = (doc: ReturnType<typeof makeDocument>, refId: string, c: Query.SameCriterion) => new Set(Query.selectSame(doc, refId, c));

describe("Query.selectSame", () => {
  // a: RED / BLACK·2 / 1   b: RED / BLUE·4 / 0.5   c: BLUE / BLACK·2 / 1   d: RED / none / 1
  const build = () => {
    const doc = makeDocument();
    const a = mk(RED, solid(BLACK), 2, 1);
    const b = mk(RED, solid(BLUE), 4, 0.5);
    const c = mk(BLUE, solid(BLACK), 2, 1);
    const d = mk(RED, noPaint(), 2, 1);
    Ops.Items.addItems(doc, [a, b, c, d]);
    return { doc, a, b, c, d };
  };

  it("matches Fill Color (reference included)", () => {
    const { doc, a, b, d } = build();
    expect(same(doc, a.id, "fill")).toEqual(new Set([a.id, b.id, d.id])); // all RED fills
  });

  it("matches Stroke Color", () => {
    const { doc, a, c } = build();
    expect(same(doc, a.id, "stroke")).toEqual(new Set([a.id, c.id])); // BLACK strokes (BLUE + none excluded)
  });

  it("matches Stroke Weight (a no-stroke object is never the same weight)", () => {
    const { doc, a, c } = build();
    expect(same(doc, a.id, "stroke-weight")).toEqual(new Set([a.id, c.id])); // width 2; d (no stroke) excluded
  });

  it("matches Opacity", () => {
    const { doc, a, c, d } = build();
    expect(same(doc, a.id, "opacity")).toEqual(new Set([a.id, c.id, d.id])); // opacity 1 (b is 0.5)
  });

  it("matches Blending Mode", () => {
    const doc = makeDocument();
    const a = mk(RED, solid(BLACK), 2, 1);
    a.blendMode = "multiply";
    const b = mk(BLUE, solid(BLUE), 4, 0.5);
    b.blendMode = "multiply";
    const c = mk(RED, solid(BLACK), 2, 1); // default "normal"
    Ops.Items.addItems(doc, [a, b, c]);
    expect(same(doc, a.id, "blend-mode")).toEqual(new Set([a.id, b.id])); // both multiply; c is normal
  });

  it("matches Fill & Stroke (fill + stroke colour + weight together, ignoring opacity)", () => {
    const doc = makeDocument();
    const a = mk(RED, solid(BLACK), 2, 1);
    const b = mk(RED, solid(BLACK), 2, 0.5); // same fill/stroke/weight, different opacity → still matches
    const c = mk(RED, solid(BLUE), 2, 1); // different stroke colour → excluded
    const d = mk(RED, solid(BLACK), 4, 1); // different stroke weight → excluded
    Ops.Items.addItems(doc, [a, b, c, d]);
    expect(same(doc, a.id, "fill-stroke")).toEqual(new Set([a.id, b.id]));
  });

  it("matches Font Family (only text; non-text never coincides)", () => {
    const doc = makeDocument();
    const tA = makeText("a", 0, 0, { fontFamily: "Helvetica", fontSize: 24 });
    const tB = makeText("b", 0, 0, { fontFamily: "Helvetica", fontSize: 48 });
    const tC = makeText("c", 0, 0, { fontFamily: "Times", fontSize: 24 });
    const r = mk(RED, solid(BLACK), 2, 1);
    Ops.Items.addItems(doc, [tA, tB, tC, r]);
    expect(same(doc, tA.id, "font-family")).toEqual(new Set([tA.id, tB.id])); // both Helvetica; Times + rect excluded
  });

  it("matches Font Size", () => {
    const doc = makeDocument();
    const tA = makeText("a", 0, 0, { fontFamily: "Helvetica", fontSize: 24 });
    const tB = makeText("b", 0, 0, { fontFamily: "Helvetica", fontSize: 48 });
    const tC = makeText("c", 0, 0, { fontFamily: "Times", fontSize: 24 });
    Ops.Items.addItems(doc, [tA, tB, tC]);
    expect(same(doc, tA.id, "font-size")).toEqual(new Set([tA.id, tC.id])); // both 24; tB (48) excluded
  });

  it("a non-text reference matches only itself for font criteria", () => {
    const doc = makeDocument();
    const r1 = mk(RED, solid(BLACK), 2, 1);
    const r2 = mk(RED, solid(BLACK), 2, 1);
    Ops.Items.addItems(doc, [r1, r2]);
    expect(same(doc, r1.id, "font-family")).toEqual(new Set([r1.id])); // per-item key — r2 not matched
  });

  it("matches Font Family & Style (family AND weight); stricter than Font Family", () => {
    const doc = makeDocument();
    const tA = makeText("a", 0, 0, { fontFamily: "Helvetica", fontWeight: 400 });
    const tB = makeText("b", 0, 0, { fontFamily: "Helvetica", fontWeight: 700 }); // same family, bolder
    const tC = makeText("c", 0, 0, { fontFamily: "Helvetica", fontWeight: 400 });
    Ops.Items.addItems(doc, [tA, tB, tC]);
    expect(same(doc, tA.id, "font-family")).toEqual(new Set([tA.id, tB.id, tC.id])); // all Helvetica
    expect(same(doc, tA.id, "font-family-style")).toEqual(new Set([tA.id, tC.id])); // tB (700) excluded
  });

  it("matches Text Fill Color (text only, by fill)", () => {
    const doc = makeDocument();
    const tA = makeText("a", 0, 0, { fill: solid(RED) });
    const tB = makeText("b", 0, 0, { fill: solid(RED) });
    const tC = makeText("c", 0, 0, { fill: solid(BLUE) });
    const r = mk(RED, solid(BLACK), 2, 1); // a rect with the SAME fill — must NOT match
    Ops.Items.addItems(doc, [tA, tB, tC, r]);
    expect(same(doc, tA.id, "text-fill")).toEqual(new Set([tA.id, tB.id])); // red text only
  });

  it("finds matches nested inside groups too", () => {
    const doc = makeDocument();
    const a = mk(RED, solid(BLACK), 2, 1);
    const nestedRed = mk(RED, solid(BLUE), 1, 1);
    const g = makeGroup([nestedRed]);
    Ops.Items.addItems(doc, [a, g]);
    expect(same(doc, a.id, "fill")).toEqual(new Set([a.id, nestedRed.id]));
  });

  it("excludes hidden and locked matches, ancestors, and layers", () => {
    const doc = makeDocument();
    const ref = mk(RED, solid(BLACK), 2, 1);
    const visible = mk(RED, solid(BLACK), 2, 1);
    const hidden = mk(RED, solid(BLACK), 2, 1);
    hidden.visible = false;
    const locked = mk(RED, solid(BLACK), 2, 1);
    locked.locked = true;
    const nested = mk(RED, solid(BLACK), 2, 1);
    const lockedGroup = makeGroup([nested]);
    lockedGroup.locked = true;
    Ops.Items.addItems(doc, [ref, visible, hidden, locked, lockedGroup]);
    const lockedLayerItem = mk(RED, solid(BLACK), 2, 1);
    const lockedLayer = makeLayer("Locked", [lockedLayerItem]);
    lockedLayer.locked = true;
    doc.layers.push(lockedLayer);

    expect(same(doc, ref.id, "fill")).toEqual(new Set([ref.id, visible.id]));
  });

  it("returns [] for a missing reference", () => {
    const { doc } = build();
    expect(Query.selectSame(doc, "nope", "fill")).toEqual([]);
  });

  it("keys paint criteria from the visible appearance", () => {
    const doc = makeDocument();
    const a = mk(BLUE, solid(BLACK), 6, 1);
    const b = mk(RED, solid(BLACK), 1, 1);
    b.appearance = {
      entries: [
        { id: "hidden-fill", kind: "fill", paint: solid(RED), visible: false },
        { id: "visible-fill", kind: "fill", paint: solid(BLUE) },
        { id: "visible-stroke", kind: "stroke", stroke: { ...defaultStroke(solid(BLACK)), width: 6 } },
      ],
    };
    Ops.Items.addItems(doc, [a, b]);

    expect(same(doc, a.id, "fill-stroke")).toEqual(new Set([a.id, b.id]));
  });
});
