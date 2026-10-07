// ─────────────────────────────────────────────────────────────
// ops/pathfinder.test — the full Illustrator Pathfinder panel (10 ops)
// ─────────────────────────────────────────────────────────────
// Parity reference (Adobe Illustrator "Combine objects using Pathfinder"):
//   Shape modes → ONE compound: unite · minus-front · intersect · exclude · minus-back
//   Pathfinders → a GROUP of pieces: divide · trim · merge · crop · outline
//
// Fixture: two axis-aligned 100×100 rects with a 50×100 horizontal overlap, so
// every face area is an exact multiple of 5000 (rect edges flatten losslessly).
//   A = [0,100]×[0,100]  (bottom, red)
//   B = [50,150]×[0,100] (top,    blue)
//   union 15000 · overlap 5000 · A-only 5000 · B-only 5000

import { describe, it, expect } from "vitest";
import { makeDocument, makeRect, Ops, Query, solid, rgba } from "../index";
import type { Item, RGBA } from "../index";

const RED = rgba(220, 0, 0);
const BLUE = rgba(0, 0, 220);

const ringArea = (anchors: { point: { x: number; y: number } }[]): number => {
  let a = 0;
  for (let i = 0, n = anchors.length; i < n; i++) {
    const p = anchors[i].point;
    const q = anchors[(i + 1) % n].point;
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a / 2);
};

/** World area of a result piece (pieces carry identity transforms; no holes in these fixtures). */
const itemArea = (it: Item): number => {
  if (it.type === "path") return ringArea(it.geometry.anchors);
  if (it.type === "compound") return it.subpaths.reduce((s, sp) => s + ringArea(sp.anchors), 0);
  return 0;
};

const fillColor = (it: Item): RGBA | null => (it.fill.type === "solid" ? it.fill.color : null);

/** Build a doc with the given rects (first = bottom of the z-order). Returns ids. */
const build = (rects: { x: number; y: number; w: number; h: number; fill: RGBA }[]) => {
  const doc = makeDocument();
  const ids: string[] = [];
  for (const r of rects) {
    const item = makeRect(r.x, r.y, r.w, r.h, 0, 0, { fill: solid(r.fill) });
    Ops.Items.addItem(doc, item);
    ids.push(item.id);
  }
  return { doc, ids };
};

/** Two overlapping rects (A red bottom, B blue top). */
const twoRects = () =>
  build([
    { x: 0, y: 0, w: 100, h: 100, fill: RED },
    { x: 50, y: 0, w: 100, h: 100, fill: BLUE },
  ]);

const run = (doc: ReturnType<typeof makeDocument>, ids: string[], op: Parameters<typeof Ops.Pathfinder.pathfinder>[2]) => {
  const id = Ops.Pathfinder.pathfinder(doc, ids, op);
  return id ? Query.getItem(doc, id) : null;
};

const children = (it: Item | null): Item[] => (it && it.type === "group" ? it.children : []);

// ── Shape modes (single compound result) ─────────────────────
describe("ops.pathfinder — shape modes", () => {
  it("unite traces the union and takes the topmost object's paint", () => {
    const { doc, ids } = twoRects();
    const out = run(doc, ids, "unite")!;
    expect(out.type === "path" || out.type === "compound").toBe(true);
    expect(itemArea(out)).toBeCloseTo(15000, 0);
    expect(fillColor(out)).toEqual(BLUE); // topmost = B
    expect(doc.layers[0].items.length).toBe(1); // originals replaced
  });

  it("intersect keeps only the overlap (topmost paint)", () => {
    const { doc, ids } = twoRects();
    const out = run(doc, ids, "intersect")!;
    expect(itemArea(out)).toBeCloseTo(5000, 0);
    expect(fillColor(out)).toEqual(BLUE);
  });

  it("exclude keeps the symmetric difference (topmost paint)", () => {
    const { doc, ids } = twoRects();
    const out = run(doc, ids, "exclude")!;
    expect(itemArea(out)).toBeCloseTo(10000, 0); // 15000 - 5000
    expect(fillColor(out)).toEqual(BLUE);
  });

  it("minus-front subtracts the front object, keeping the back object's paint", () => {
    const { doc, ids } = twoRects();
    const out = run(doc, ids, "minus-front")!;
    expect(itemArea(out)).toBeCloseTo(5000, 0); // A \ B
    expect(fillColor(out)).toEqual(RED); // survivor = back = A
  });

  it("minus-back subtracts the back object, keeping the front object's paint", () => {
    const { doc, ids } = twoRects();
    const out = run(doc, ids, "minus-back")!;
    expect(itemArea(out)).toBeCloseTo(5000, 0); // B \ A
    expect(fillColor(out)).toEqual(BLUE); // survivor = front = B
  });

  it("does not intersect artwork inside an even-odd compound hole", () => {
    const doc = makeDocument();
    const outer = makeRect(0, 0, 100, 100, 0, 0, { fill: solid(RED) });
    const hole = makeRect(25, 25, 50, 50, 0, 0, { fill: solid(RED) });
    Ops.Items.addItems(doc, [outer, hole]);
    const donut = Ops.PathEdit.makeCompoundPath(doc, [outer.id, hole.id])!;
    const probe = makeRect(40, 40, 20, 20, 0, 0, { fill: solid(BLUE) });
    Ops.Items.addItem(doc, probe);

    expect(Ops.Pathfinder.pathfinder(doc, [donut, probe.id], "intersect")).toBeNull();
    expect(doc.layers[0].items).toHaveLength(0);
  });
});

// ── Pathfinders (grouped pieces) ─────────────────────────────
describe("ops.pathfinder — Divide", () => {
  it("splits the selection into its three component faces", () => {
    const { doc, ids } = twoRects();
    const out = run(doc, ids, "divide");
    expect(out?.type).toBe("group");
    const kids = children(out);
    expect(kids.length).toBe(3); // A-only, overlap, B-only
    const total = kids.reduce((s, k) => s + itemArea(k), 0);
    expect(total).toBeCloseTo(15000, 0);
    // Every face ~5000; overlap + B-only carry B's fill, A-only carries A's.
    for (const k of kids) expect(itemArea(k)).toBeCloseTo(5000, 0);
    const reds = kids.filter((k) => fillColor(k)?.r === RED.r).length;
    const blues = kids.filter((k) => fillColor(k)?.b === BLUE.b).length;
    expect(reds).toBe(1);
    expect(blues).toBe(2);
  });
});

describe("ops.pathfinder — Trim", () => {
  it("removes hidden parts, keeps each object separate with its own fill, drops strokes", () => {
    const { doc, ids } = twoRects();
    const out = run(doc, ids, "trim");
    const kids = children(out);
    expect(kids.length).toBe(2); // one per object
    const areas = kids.map(itemArea).sort((a, b) => a - b);
    expect(areas[0]).toBeCloseTo(5000, 0); // A trimmed (A \ B)
    expect(areas[1]).toBeCloseTo(10000, 0); // B whole (on top)
    expect(kids.every((k) => k.stroke.paint.type === "none")).toBe(true);
  });

  it("does NOT merge two abutting same-colour objects", () => {
    const { doc, ids } = build([
      { x: 0, y: 0, w: 100, h: 100, fill: RED },
      { x: 50, y: 0, w: 100, h: 100, fill: RED }, // same colour
    ]);
    const kids = children(run(doc, ids, "trim"));
    expect(kids.length).toBe(2); // stays separate
  });
});

describe("ops.pathfinder — Merge", () => {
  it("merges abutting same-colour objects into a single shape", () => {
    const { doc, ids } = build([
      { x: 0, y: 0, w: 100, h: 100, fill: RED },
      { x: 50, y: 0, w: 100, h: 100, fill: RED },
    ]);
    const out = run(doc, ids, "merge");
    const kids = children(out);
    expect(kids.length).toBe(1); // unioned
    expect(itemArea(kids[0])).toBeCloseTo(15000, 0);
    expect(kids[0].stroke.paint.type).toBe("none");
  });

  it("behaves like Trim for different-colour objects (no merge)", () => {
    const { doc, ids } = twoRects(); // red + blue
    const kids = children(run(doc, ids, "merge"));
    expect(kids.length).toBe(2);
    const total = kids.reduce((s, k) => s + itemArea(k), 0);
    expect(total).toBeCloseTo(15000, 0);
  });

  it("groups and paints by the top appearance fill", () => {
    const { doc, ids } = build([
      { x: 0, y: 0, w: 100, h: 100, fill: RED },
      { x: 50, y: 0, w: 100, h: 100, fill: BLUE },
      { x: 200, y: 0, w: 100, h: 100, fill: RED },
    ]);
    const first = Query.getItem(doc, ids[0])!;
    first.appearance = { entries: [
      { id: "bottom", kind: "fill", paint: solid(RED) },
      { id: "top", kind: "fill", paint: solid(BLUE) },
    ] };

    const kids = children(run(doc, ids, "merge"));
    expect(kids.map((item) => [itemArea(item), fillColor(item)]).sort((a, b) => Number(a[0]) - Number(b[0]))).toEqual([
      [10000, RED],
      [15000, BLUE],
    ]);
  });
});

describe("ops.pathfinder — Crop", () => {
  it("keeps only the art inside the frontmost object, using the underlying fill", () => {
    const { doc, ids } = twoRects(); // B (blue) on top is the crop boundary
    const out = run(doc, ids, "crop");
    const kids = children(out);
    const total = kids.reduce((s, k) => s + itemArea(k), 0);
    expect(total).toBeCloseTo(5000, 0); // A ∩ B only
    // The cropped piece carries the UNDERLYING fill (A = red), not the cutter's.
    expect(kids.every((k) => fillColor(k)?.r === RED.r)).toBe(true);
    expect(kids.every((k) => k.stroke.paint.type === "none")).toBe(true);
  });
});

describe("ops.pathfinder — Outline", () => {
  it("reduces objects to open, unfilled, stroked edges painted with the source fill", () => {
    // Diagonal overlap so the outlines genuinely cross (transversal cuts).
    const { doc, ids } = build([
      { x: 0, y: 0, w: 100, h: 100, fill: RED },
      { x: 50, y: 50, w: 100, h: 100, fill: BLUE },
    ]);
    const out = run(doc, ids, "outline");
    const kids = children(out);
    expect(kids.length).toBeGreaterThanOrEqual(4); // each ring split at its 2 crossings
    expect(kids.every((k) => k.type === "path")).toBe(true);
    expect(kids.every((k) => k.type === "path" && k.geometry.closed === false)).toBe(true);
    expect(kids.every((k) => k.fill.type === "none")).toBe(true);
    expect(kids.every((k) => k.stroke.paint.type === "solid")).toBe(true);
    // Both source colours show up as stroke paints.
    const strokeReds = kids.filter((k) => k.stroke.paint.type === "solid" && k.stroke.paint.color.r === RED.r).length;
    const strokeBlues = kids.filter((k) => k.stroke.paint.type === "solid" && k.stroke.paint.color.b === BLUE.b).length;
    expect(strokeReds).toBeGreaterThan(0);
    expect(strokeBlues).toBeGreaterThan(0);
  });
});

// ── Guards ───────────────────────────────────────────────────
describe("ops.pathfinder — guards", () => {
  it("returns null for fewer than two drawable objects", () => {
    const { doc, ids } = build([{ x: 0, y: 0, w: 100, h: 100, fill: RED }]);
    for (const op of ["unite", "divide", "trim", "merge", "crop", "outline"] as const)
      expect(Ops.Pathfinder.pathfinder(doc, ids, op)).toBeNull();
  });
});
