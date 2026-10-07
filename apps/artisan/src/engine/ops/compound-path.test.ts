// ─────────────────────────────────────────────────────────────
// ops/compound-path.test — Object ▸ Compound Path ▸ Make / Release (parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Compound Path.
//  • Make (⌘8): combine ≥2 selected paths into ONE compound path. Overlapping
//    areas become holes; the result takes the BACKMOST object's paint.
//  • Release (⌥⌘8): split the compound back into its component paths; every
//    released path keeps the compound's appearance (originals' colours are NOT
//    restored).

import { describe, it, expect } from "vitest";
import { makeDocument, makeRect, makeCompound, makeGroup, Ops, Query, solid, rgba } from "../index";

const RED = rgba(220, 0, 0);
const BLUE = rgba(0, 0, 220);

const xRange = (anchors: { point: { x: number } }[]) => {
  const xs = anchors.map((a) => a.point.x);
  return [Math.min(...xs), Math.max(...xs)] as const;
};

describe("ops.path-edit.makeCompoundPath / releaseCompoundPath", () => {
  it("Make: combines two stacked shapes into one even-odd compound (backmost paint)", () => {
    const doc = makeDocument();
    const back = makeRect(50, 60, 100, 100, 0, 0, { fill: solid(RED) }); // added first → backmost
    const front = makeRect(80, 90, 40, 40, 0, 0, { fill: solid(BLUE) });
    Ops.Items.addItem(doc, back);
    Ops.Items.addItem(doc, front);

    const id = Ops.PathEdit.makeCompoundPath(doc, [back.id, front.id]);
    expect(id).not.toBeNull();
    // the two sources collapse into a single item
    expect(doc.layers[0].items.length).toBe(1);
    const c = Query.getItem(doc, id!)!;
    expect(c.type).toBe("compound");
    if (c.type !== "compound") return;
    expect(c.subpaths.length).toBe(2);
    expect(c.fill).toEqual(solid(RED)); // backmost wins; front blue discarded
    expect(c.evenOdd).toBe(true); // overlaps become holes
    // geometry baked into WORLD space (identity transform, anchors at world coords)
    expect(c.transform).toEqual({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
    expect(xRange(c.subpaths[0].anchors)).toEqual([50, 150]); // outer rect (world)
    expect(xRange(c.subpaths[1].anchors)).toEqual([80, 120]); // inner rect (world)
  });

  it("Make: needs ≥2 contributing paths — a lone shape is left untouched", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 50, 50, 0, 0, { fill: solid(RED) });
    Ops.Items.addItem(doc, r);
    expect(Ops.PathEdit.makeCompoundPath(doc, [r.id])).toBeNull();
    expect(doc.layers[0].items.length).toBe(1);
    expect(Query.getItem(doc, r.id)).not.toBeNull();
  });

  it("Make: skips groups/non-paths (group survives; only the two rects combine)", () => {
    const doc = makeDocument();
    const a = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(RED) });
    const b = makeRect(20, 20, 40, 40, 0, 0, { fill: solid(BLUE) });
    const g = makeGroup([makeRect(200, 200, 10, 10)], { name: "G" });
    Ops.Items.addItem(doc, a);
    Ops.Items.addItem(doc, b);
    Ops.Items.addItem(doc, g);

    const id = Ops.PathEdit.makeCompoundPath(doc, [a.id, b.id, g.id]);
    expect(id).not.toBeNull();
    const c = Query.getItem(doc, id!)!;
    expect(c.type).toBe("compound");
    if (c.type === "compound") expect(c.subpaths.length).toBe(2); // group contributed nothing
    expect(Query.getItem(doc, g.id)?.type).toBe("group"); // group untouched
    expect(doc.layers[0].items.length).toBe(2); // compound + group
  });

  it("Release: splits a compound into separate paths that keep its appearance", () => {
    const doc = makeDocument();
    const ring = (cx: number) => ({
      closed: true,
      anchors: [
        { point: { x: cx, y: 0 }, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } },
        { point: { x: cx + 30, y: 0 }, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } },
        { point: { x: cx + 30, y: 30 }, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } },
        { point: { x: cx, y: 30 }, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } },
      ],
    });
    const comp = makeCompound([ring(0), ring(50)], { fill: solid(RED) });
    comp.evenOdd = true;
    Ops.Items.addItem(doc, comp);

    const ids = Ops.PathEdit.releaseCompoundPath(doc, [comp.id]);
    expect(ids.length).toBe(2);
    expect(Query.getItem(doc, comp.id)).toBeNull(); // compound gone
    expect(doc.layers[0].items.length).toBe(2);
    for (const pid of ids) {
      const p = Query.getItem(doc, pid)!;
      expect(p.type).toBe("path");
      expect(p.fill).toEqual(solid(RED)); // compound appearance carried to every piece
    }
  });

  it("Make → Release round-trips back to two independent paths", () => {
    const doc = makeDocument();
    const a = makeRect(10, 10, 30, 30, 0, 0, { fill: solid(RED) });
    const b = makeRect(60, 10, 30, 30, 0, 0, { fill: solid(BLUE) });
    Ops.Items.addItem(doc, a);
    Ops.Items.addItem(doc, b);

    const cid = Ops.PathEdit.makeCompoundPath(doc, [a.id, b.id])!;
    const ids = Ops.PathEdit.releaseCompoundPath(doc, [cid]);
    expect(ids.length).toBe(2);
    expect(doc.layers[0].items.length).toBe(2);
    const ranges = ids.map((id) => xRange((Query.getItem(doc, id) as { geometry: { anchors: { point: { x: number } }[] } }).geometry.anchors));
    expect(ranges).toContainEqual([10, 40]);
    expect(ranges).toContainEqual([60, 90]);
  });
});
