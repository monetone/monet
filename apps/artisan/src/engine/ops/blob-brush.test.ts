// ─────────────────────────────────────────────────────────────
// ops/blob-brush.test — Blob Brush merge (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Blob Brush — a painted stroke MERGES into every
// existing shape it touches that has the SAME fill colour and NO stroke; other
// shapes are left alone and the blob becomes its own shape.

import { describe, it, expect } from "vitest";
import { makeDocument, makeRect, Ops, Query, solid, noPaint, defaultStroke, rgba } from "../index";
import type { Item } from "../index";

const RED = rgba(220, 0, 0);
const BLUE = rgba(0, 0, 220);
const noStroke = () => defaultStroke(noPaint());

type MP = Parameters<typeof Ops.Pathfinder.blobBrushCommit>[1];
/** A square nib region (one polygon, one ring). */
const rectRegion = (x: number, y: number, w: number, h: number): MP =>
  [[[[x, y], [x + w, y], [x + w, y + h], [x, y + h]]]] as unknown as MP;

const ringArea = (anchors: { point: { x: number; y: number } }[]): number => {
  let a = 0;
  for (let i = 0, n = anchors.length; i < n; i++) {
    const p = anchors[i].point;
    const q = anchors[(i + 1) % n].point;
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a / 2);
};
const itemArea = (it: Item): number =>
  it.type === "path" ? ringArea(it.geometry.anchors) : it.type === "compound" ? it.subpaths.reduce((s, sp) => s + ringArea(sp.anchors), 0) : 0;

const commit = (doc: ReturnType<typeof makeDocument>, region: MP, fill = solid(RED)) =>
  Ops.Pathfinder.blobBrushCommit(doc, region, fill, noStroke(), doc.layers[0].id);

describe("ops.pathfinder.blobBrushCommit", () => {
  it("creates a standalone shape when nothing matches", () => {
    const doc = makeDocument();
    const id = commit(doc, rectRegion(0, 0, 20, 20));
    expect(id).not.toBeNull();
    expect(doc.layers[0].items.length).toBe(1);
    expect(itemArea(doc.layers[0].items[0])).toBeCloseTo(400, 0);
  });

  it("MERGES into an overlapping same-fill, no-stroke shape", () => {
    const doc = makeDocument();
    const rect = makeRect(10, 0, 20, 20, 0, 0, { fill: solid(RED), stroke: noStroke() }); // red, no stroke
    Ops.Items.addItem(doc, rect);
    commit(doc, rectRegion(0, 0, 20, 20)); // overlaps the rect (x 10–20)
    expect(doc.layers[0].items.length).toBe(1); // merged into ONE shape
    expect(Query.getItem(doc, rect.id)).toBeNull(); // the old rect was consumed
    expect(itemArea(doc.layers[0].items[0])).toBeCloseTo(600, 0); // union of [0,20]² and [10,30]×[0,20]
  });

  it("does NOT merge a different-fill shape", () => {
    const doc = makeDocument();
    const blue = makeRect(10, 0, 20, 20, 0, 0, { fill: solid(BLUE), stroke: noStroke() });
    Ops.Items.addItem(doc, blue);
    commit(doc, rectRegion(0, 0, 20, 20)); // red blob over a blue rect
    expect(doc.layers[0].items.length).toBe(2); // blue rect + separate red blob
    expect(Query.getItem(doc, blue.id)).not.toBeNull();
  });

  it("does NOT merge a same-fill shape that HAS a stroke", () => {
    const doc = makeDocument();
    const stroked = makeRect(10, 0, 20, 20, 0, 0, { fill: solid(RED), stroke: defaultStroke(solid(rgba(0, 0, 0))) });
    Ops.Items.addItem(doc, stroked);
    commit(doc, rectRegion(0, 0, 20, 20));
    expect(doc.layers[0].items.length).toBe(2);
  });

  it("does NOT merge a same-fill shape it never touches", () => {
    const doc = makeDocument();
    const far = makeRect(200, 0, 20, 20, 0, 0, { fill: solid(RED), stroke: noStroke() });
    Ops.Items.addItem(doc, far);
    commit(doc, rectRegion(0, 0, 20, 20));
    expect(doc.layers[0].items.length).toBe(2);
  });
});
