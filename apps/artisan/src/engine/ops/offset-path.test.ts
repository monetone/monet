// ─────────────────────────────────────────────────────────────
// ops/offset-path.test — Object ▸ Path ▸ Offset Path (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Object ▸ Path ▸ Offset Path — creates a NEW path
// offset from the original by a fixed distance (+ outward / − inward), with
// Miter/Round/Bevel joins. The original object is preserved; the offset copy is
// inserted directly above it and inherits its fill/stroke/transform.

import { describe, it, expect } from "vitest";
import {
  makeDocument,
  makePath,
  makeCompound,
  makeRect,
  makeText,
  makeAnchor as anchor,
  Ops,
  Query,
  solid,
  rgba,
  defaultStroke,
  noPaint,
} from "../index";

const RED = rgba(220, 0, 0);
const square = (s = 100) => ({
  closed: true,
  anchors: [anchor({ x: 0, y: 0 }), anchor({ x: s, y: 0 }), anchor({ x: s, y: s }), anchor({ x: 0, y: s })],
});
const box = (doc: ReturnType<typeof makeDocument>, id: string) => Query.worldBounds(doc, id)!;
const anchorsOf = (doc: ReturnType<typeof makeDocument>, id: string) => {
  const it = Query.getItem(doc, id)!;
  if (it.type !== "path") throw new Error("not a path");
  return it.geometry.anchors;
};

describe("ops.offset-path.offsetPath — closed paths", () => {
  it("grows a closed square outward and KEEPS the original (new path above)", () => {
    const doc = makeDocument();
    const p = makePath(square(100), { fill: solid(RED), stroke: defaultStroke(solid(RED)) });
    Ops.Items.addItem(doc, p);
    const before = doc.layers[0].items.length;

    const ids = Ops.OffsetPath.offsetPath(doc, [p.id], { distance: 10, join: "miter" });

    expect(ids).toHaveLength(1);
    expect(doc.layers[0].items.length).toBe(before + 1); // original kept + offset added
    expect(Query.getItem(doc, p.id)).toBeTruthy(); // original still present
    // offset path sits directly above the original in z-order
    const idx = doc.layers[0].items.findIndex((i) => i.id === p.id);
    expect(doc.layers[0].items[idx + 1].id).toBe(ids[0]);
    // +10 on every side: 100×100 → 120×120 centred on the original
    const b = box(doc, ids[0]);
    expect([b.x, b.y, b.width, b.height]).toEqual([-10, -10, 120, 120]);
  });

  it("shrinks a closed square for a negative distance", () => {
    const doc = makeDocument();
    const p = makePath(square(100));
    Ops.Items.addItem(doc, p);
    const ids = Ops.OffsetPath.offsetPath(doc, [p.id], { distance: -10 });
    const b = box(doc, ids[0]);
    expect([b.x, b.y, b.width, b.height]).toEqual([10, 10, 80, 80]);
  });

  it("inherits the source fill/stroke and stays a path", () => {
    const doc = makeDocument();
    const p = makePath(square(100), { fill: solid(RED), stroke: defaultStroke(noPaint()) });
    Ops.Items.addItem(doc, p);
    const ids = Ops.OffsetPath.offsetPath(doc, [p.id], { distance: 5 });
    const it = Query.getItem(doc, ids[0])!;
    expect(it.type).toBe("path");
    expect(it.fill).toEqual(solid(RED));
    expect(it.stroke.paint.type).toBe("none");
  });

  it("round joins add more anchors than miter joins", () => {
    const doc = makeDocument();
    const p = makePath(square(100));
    Ops.Items.addItem(doc, p);
    const miter = Ops.OffsetPath.offsetPath(doc, [p.id], { distance: 10, join: "miter" });
    const round = Ops.OffsetPath.offsetPath(doc, [p.id], { distance: 10, join: "round" });
    expect(anchorsOf(doc, miter[0]).length).toBe(4);
    expect(anchorsOf(doc, round[0]).length).toBeGreaterThan(4);
  });
});

describe("ops.offset-path.offsetPath — shapes, compound & open paths", () => {
  it("offsets a live rect shape into a grown path at the same position", () => {
    const doc = makeDocument();
    const r = makeRect(50, 60, 100, 80, 0, 0, { fill: solid(RED) });
    Ops.Items.addItem(doc, r);
    const ids = Ops.OffsetPath.offsetPath(doc, [r.id], { distance: 10 });
    expect(ids).toHaveLength(1);
    const b = box(doc, ids[0]);
    // rect world bounds 50,60,100,80 → grow 10 on each side
    expect([b.x, b.y, b.width, b.height]).toEqual([40, 50, 120, 100]);
  });

  it("offsets every subpath of a compound path", () => {
    const doc = makeDocument();
    const ring = (s: number, o: number) => ({
      closed: true,
      anchors: [anchor({ x: o, y: o }), anchor({ x: o + s, y: o }), anchor({ x: o + s, y: o + s }), anchor({ x: o, y: o + s })],
    });
    const comp = makeCompound([ring(100, 0), ring(40, 30)], { fill: solid(RED) });
    Ops.Items.addItem(doc, comp);
    const ids = Ops.OffsetPath.offsetPath(doc, [comp.id], { distance: 5 });
    const it = Query.getItem(doc, ids[0])!;
    expect(it.type).toBe("compound");
    if (it.type === "compound") expect(it.subpaths).toHaveLength(2);
  });

  it("offsets an OPEN path into a closed outline band", () => {
    const doc = makeDocument();
    const line = makePath(
      { closed: false, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 100, y: 0 })] },
      { fill: noPaint(), stroke: defaultStroke(solid(RED)) },
    );
    Ops.Items.addItem(doc, line);
    const ids = Ops.OffsetPath.offsetPath(doc, [line.id], { distance: 10 });
    expect(ids).toHaveLength(1);
    const it = Query.getItem(doc, ids[0])!;
    // a closed band: width 2·|d| = 20 around the 100-long line
    expect(it.type === "path" ? it.geometry.closed : true).toBe(true);
    const b = box(doc, ids[0]);
    expect(b.height).toBeCloseTo(20, 6); // ±10 around y=0
    expect(b.width).toBeCloseTo(100, 6);
  });
});

describe("ops.offset-path.offsetPath — guards", () => {
  it("returns no ids and adds nothing for a zero distance", () => {
    const doc = makeDocument();
    const p = makePath(square(100));
    Ops.Items.addItem(doc, p);
    const before = doc.layers[0].items.length;
    expect(Ops.OffsetPath.offsetPath(doc, [p.id], { distance: 0 })).toEqual([]);
    expect(doc.layers[0].items.length).toBe(before);
  });

  it("skips items with no path geometry (text)", () => {
    const doc = makeDocument();
    const t = makeText("Hi", 10, 20);
    Ops.Items.addItem(doc, t);
    const ids = Ops.OffsetPath.offsetPath(doc, [t.id], { distance: 10 });
    expect(ids).toEqual([]);
  });
});
