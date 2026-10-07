// ─────────────────────────────────────────────────────────────
// ops/select-objects.test — Select ▸ Object (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Select ▸ Object — select all Text Objects, Stray
// Points (single-anchor paths), or Clipping Masks across the document.

import { describe, it, expect } from "vitest";
import { makeDocument, makeLayer, makeText, makeRect, makePath, makeGroup, makeAnchor as anchor, Ops, solid, rgba } from "../index";

const RED = rgba(220, 0, 0);

describe("ops.select-objects.matchingObjectIds", () => {
  it("selects every text object (including nested in groups)", () => {
    const doc = makeDocument();
    const t1 = makeText("a", 0, 0);
    const t2 = makeText("b", 0, 0);
    const r = makeRect(0, 0, 10, 10, 0, 0, { fill: solid(RED) });
    const grp = makeGroup([t2, r]); // t2 is nested
    Ops.Items.addItem(doc, t1);
    Ops.Items.addItem(doc, grp);
    const ids = Ops.SelectObjects.matchingObjectIds(doc, "text");
    expect(new Set(ids)).toEqual(new Set([t1.id, t2.id]));
  });

  it("splits point text from area text and text-on-a-path", () => {
    const doc = makeDocument();
    const point = makeText("point", 0, 0); // no box, no path
    const area = makeText("area", 0, 0);
    area.boxWidth = 200;
    area.boxHeight = 80; // area text (fixed box)
    const onPath = makeText("path", 0, 0);
    onPath.pathD = "M0 0 L100 0"; // type-on-a-path
    Ops.Items.addItem(doc, point);
    Ops.Items.addItem(doc, area);
    Ops.Items.addItem(doc, onPath);
    // "text" matches all three; point/area each match only their own kind.
    expect(new Set(Ops.SelectObjects.matchingObjectIds(doc, "text"))).toEqual(new Set([point.id, area.id, onPath.id]));
    expect(Ops.SelectObjects.matchingObjectIds(doc, "point-text")).toEqual([point.id]);
    expect(Ops.SelectObjects.matchingObjectIds(doc, "area-text")).toEqual([area.id]);
  });

  it("treats a box with only a width as area text", () => {
    const doc = makeDocument();
    const area = makeText("area", 0, 0);
    area.boxWidth = 150; // height left to auto — still area text
    Ops.Items.addItem(doc, area);
    expect(Ops.SelectObjects.matchingObjectIds(doc, "area-text")).toEqual([area.id]);
    expect(Ops.SelectObjects.matchingObjectIds(doc, "point-text")).toEqual([]);
  });

  it("selects stray points (single-anchor paths) only", () => {
    const doc = makeDocument();
    const stray = makePath({ closed: false, anchors: [anchor({ x: 5, y: 5 })] });
    const line = makePath({ closed: false, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 10, y: 0 })] });
    Ops.Items.addItem(doc, stray);
    Ops.Items.addItem(doc, line);
    expect(Ops.SelectObjects.matchingObjectIds(doc, "stray-points")).toEqual([stray.id]);
  });

  it("selects the clipping path of each clip group", () => {
    const doc = makeDocument();
    const maskPath = makeRect(0, 0, 50, 50, 0, 0, { fill: solid(RED) });
    const content = makeRect(10, 10, 80, 80, 0, 0, { fill: solid(RED) });
    const clip = makeGroup([maskPath, content]);
    clip.clip = true; // children[0] is the clip path
    Ops.Items.addItem(doc, clip);
    expect(Ops.SelectObjects.matchingObjectIds(doc, "clipping-masks")).toEqual([maskPath.id]);
  });

  it("ignores a non-clip group for clipping-masks", () => {
    const doc = makeDocument();
    const grp = makeGroup([makeRect(0, 0, 10, 10, 0, 0, { fill: solid(RED) })]);
    Ops.Items.addItem(doc, grp);
    expect(Ops.SelectObjects.matchingObjectIds(doc, "clipping-masks")).toEqual([]);
  });

  it("returns [] when nothing matches", () => {
    const doc = makeDocument();
    Ops.Items.addItem(doc, makeRect(0, 0, 10, 10, 0, 0, { fill: solid(RED) }));
    expect(Ops.SelectObjects.matchingObjectIds(doc, "text")).toEqual([]);
  });

  it("excludes hidden and locked objects, ancestors, layers, and clip paths", () => {
    const doc = makeDocument();
    const visible = makeText("visible", 0, 0);
    const hidden = makeText("hidden", 0, 0);
    hidden.visible = false;
    const locked = makeText("locked", 0, 0);
    locked.locked = true;
    const nested = makeText("nested", 0, 0);
    const lockedGroup = makeGroup([nested]);
    lockedGroup.locked = true;
    const mask = makeRect(0, 0, 10, 10, 0, 0);
    mask.locked = true;
    const clip = makeGroup([mask, makeRect(0, 0, 10, 10, 0, 0)]);
    clip.clip = true;
    Ops.Items.addItems(doc, [visible, hidden, locked, lockedGroup, clip]);
    const layerText = makeText("layer", 0, 0);
    const layer = makeLayer("Locked", [layerText]);
    layer.locked = true;
    doc.layers.push(layer);

    expect(Ops.SelectObjects.matchingObjectIds(doc, "text")).toEqual([visible.id]);
    expect(Ops.SelectObjects.matchingObjectIds(doc, "clipping-masks")).toEqual([]);
  });
});
