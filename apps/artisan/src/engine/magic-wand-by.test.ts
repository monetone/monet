// ─────────────────────────────────────────────────────────────
// magic-wand-by.test — Magic Wand match by Fill / Stroke colour (parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Magic Wand panel — the wand can match on Fill
// Colour or Stroke Colour (each within Tolerance). magicWandSelectBy(doc, ref,
// match, tol) generalises magicWandSelect over the chosen attribute.

import { describe, it, expect } from "vitest";
import { makeDocument, makeRect, makeGroup, makeLayer, Ops, Query, solid, rgba, linearGradient } from "./index";
import type { Paint } from "./index";

const RED = rgba(220, 90, 90);
const BLUE = rgba(0, 0, 220);
const YELLOW = rgba(220, 220, 0);

// rect with an explicit fill + stroke colour
const rk = (fill: Paint, strokePaint: Paint) => {
  const r = makeRect(0, 0, 10, 10, 0, 0, { fill });
  r.stroke = { ...r.stroke, paint: strokePaint };
  return r;
};

describe("Query.magicWandSelectBy", () => {
  it("match 'stroke' selects by STROKE colour, ignoring fill differences", () => {
    const doc = makeDocument();
    const a = rk(solid(RED), solid(BLUE)); // click target
    const b = rk(solid(rgba(0, 180, 0)), solid(BLUE)); // different fill, SAME stroke → match
    const c = rk(solid(RED), solid(YELLOW)); // SAME fill, different stroke → no match
    Ops.Items.addItems(doc, [a, b, c]);
    expect(new Set(Query.magicWandSelectBy(doc, a, "stroke", 32))).toEqual(new Set([a.id, b.id]));
  });

  it("match 'stroke' honours the colour tolerance (within vs over)", () => {
    const doc = makeDocument();
    const a = rk(solid(RED), solid(rgba(0, 0, 220)));
    const within = rk(solid(RED), solid(rgba(20, 10, 200))); // Δ(20,10,20) ≤ 32
    const over = rk(solid(RED), solid(rgba(0, 0, 180))); // Δ40 > 32
    Ops.Items.addItems(doc, [a, within, over]);
    expect(new Set(Query.magicWandSelectBy(doc, a, "stroke", 32))).toEqual(new Set([a.id, within.id]));
  });

  it("match 'fill' is identical to the fill-only magicWandSelect", () => {
    const doc = makeDocument();
    const a = rk(solid(RED), solid(BLUE));
    const b = rk(solid(rgba(200, 80, 100)), solid(YELLOW)); // fill within 32 of a, stroke differs
    const c = rk(solid(rgba(80, 120, 220)), solid(BLUE)); // fill far
    Ops.Items.addItems(doc, [a, b, c]);
    expect(Query.magicWandSelectBy(doc, a, "fill", 32)).toEqual(Query.magicWandSelect(doc, a.fill, 32));
    expect(new Set(Query.magicWandSelectBy(doc, a, "fill", 32))).toEqual(new Set([a.id, b.id]));
  });

  it("match 'stroke' on a non-solid stroke matches by TYPE (gradient strokes), excluding solids", () => {
    const doc = makeDocument();
    const refg = rk(solid(RED), linearGradient()); // gradient stroke (click target)
    const otherg = rk(solid(BLUE), linearGradient()); // gradient stroke → matches by type
    const solidStroke = rk(solid(RED), solid(BLUE)); // solid stroke → type differs, excluded
    Ops.Items.addItems(doc, [refg, otherg, solidStroke]);
    expect(new Set(Query.magicWandSelectBy(doc, refg, "stroke", 32))).toEqual(new Set([refg.id, otherg.id]));
  });

  it("skips groups (matches nested leaves), hidden, and locked objects", () => {
    const doc = makeDocument();
    const a = rk(solid(RED), solid(BLUE));
    const nested = rk(solid(YELLOW), solid(BLUE)); // same stroke, inside a group
    const grp = makeGroup([nested]);
    const hidden = rk(solid(RED), solid(BLUE));
    hidden.visible = false;
    const locked = rk(solid(RED), solid(BLUE));
    locked.locked = true;
    Ops.Items.addItems(doc, [a, grp, hidden, locked]);
    expect(new Set(Query.magicWandSelectBy(doc, a, "stroke", 32))).toEqual(new Set([a.id, nested.id]));
  });

  it("matches the top visible appearance paint", () => {
    const doc = makeDocument();
    const a = rk(solid(BLUE), solid(YELLOW));
    const b = rk(solid(RED), solid(YELLOW));
    b.appearance = {
      entries: [
        { id: "bottom", kind: "fill", paint: solid(RED) },
        { id: "top", kind: "fill", paint: solid(BLUE) },
      ],
    };
    Ops.Items.addItems(doc, [a, b]);

    expect(new Set(Query.magicWandSelect(doc, solid(BLUE), 0))).toEqual(new Set([a.id, b.id]));
    expect(new Set(Query.magicWandSelectBy(doc, a, "fill", 0))).toEqual(new Set([a.id, b.id]));
  });

  it("excludes matches behind hidden or locked ancestors and layers in both entry points", () => {
    const doc = makeDocument();
    const ref = rk(solid(RED), solid(BLUE));
    const visible = rk(solid(RED), solid(BLUE));
    const hiddenNested = rk(solid(RED), solid(BLUE));
    const hiddenGroup = makeGroup([hiddenNested]);
    hiddenGroup.visible = false;
    const lockedNested = rk(solid(RED), solid(BLUE));
    const lockedGroup = makeGroup([lockedNested]);
    lockedGroup.locked = true;
    Ops.Items.addItems(doc, [ref, visible, hiddenGroup, lockedGroup]);
    const hiddenLayerItem = rk(solid(RED), solid(BLUE));
    const hiddenLayer = makeLayer("Hidden", [hiddenLayerItem]);
    hiddenLayer.visible = false;
    const lockedLayerItem = rk(solid(RED), solid(BLUE));
    const lockedLayer = makeLayer("Locked", [lockedLayerItem]);
    lockedLayer.locked = true;
    doc.layers.push(hiddenLayer, lockedLayer);

    expect(new Set(Query.magicWandSelect(doc, solid(RED), 0))).toEqual(new Set([ref.id, visible.id]));
    expect(new Set(Query.magicWandSelectBy(doc, ref, "stroke", 0))).toEqual(new Set([ref.id, visible.id]));
  });
});
