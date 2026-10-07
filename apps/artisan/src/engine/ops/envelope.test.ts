// ─────────────────────────────────────────────────────────────
// ops/envelope.test — Object ▸ Envelope Distort (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Object ▸ Envelope Distort. "Make with Warp" bends
// the selection inside one shared box; "Make with Top Object" consumes the
// frontmost object as an envelope outline and maps the rest into it. The envelope
// is LIVE: the originals are kept, so re-bending re-derives from them (never
// compounding), Release restores them (plus the outline), and Expand keeps the
// distorted art and drops the envelope.

import { describe, it, expect } from "vitest";
import { makeDocument, makeRect, makePath, makeAnchor as anchor, Ops, paintedFill, Query, solid, rgba, type GroupItem, type PathItem } from "../index";

const RED = rgba(220, 0, 0);
const BLUE = rgba(0, 0, 220);

const doc3 = () => {
  const doc = makeDocument();
  const a = makeRect(0, 0, 100, 40, 0, 0, { fill: solid(RED) });
  const b = makeRect(0, 60, 100, 40, 0, 0, { fill: solid(RED) });
  Ops.Items.addItem(doc, a);
  Ops.Items.addItem(doc, b);
  return { doc, a, b };
};
const topItems = (doc: ReturnType<typeof makeDocument>) => doc.layers.flatMap((l) => l.items);
const groupOf = (doc: ReturnType<typeof makeDocument>, id: string) => Query.getItem(doc, id) as GroupItem;

describe("ops.envelope — Make with Warp", () => {
  it("wraps the selection in an envelope group that keeps the originals", () => {
    const { doc, a, b } = doc3();
    const gid = Ops.Envelope.makeWithWarp(doc, [a.id, b.id], { style: "arc", bend: 0.5 })!;
    expect(gid).toBeTruthy();

    const g = groupOf(doc, gid);
    expect(g.envelope?.kind).toBe("warp");
    expect(g.envelope?.warp).toEqual({ style: "arc", bend: 0.5 });
    expect(g.envelope?.sourceItems).toHaveLength(2); // undistorted originals kept
    expect(topItems(doc)).toHaveLength(1);
  });

  it("carries the visible Appearance stack into regenerated paths", () => {
    const doc = makeDocument();
    const source = makeRect(0, 0, 100, 40, 0, 0, { fill: solid(RED) });
    source.appearance = {
      entries: [
        { id: "hidden-red", kind: "fill", paint: solid(RED), visible: false },
        { id: "visible-blue", kind: "fill", paint: solid(BLUE) },
      ],
    };
    Ops.Items.addItem(doc, source);

    const id = Ops.Envelope.makeWithWarp(doc, [source.id], { style: "arc", bend: 0.5 })!;
    const baked = groupOf(doc, id).children[0];

    expect(baked.appearance).toEqual(source.appearance);
    expect(paintedFill(baked)).toEqual(solid(BLUE));
  });

  it("bends both objects inside ONE shared box, not each in its own", () => {
    // Two rects of DIFFERENT heights: 100×40 at y=0 and 100×140 at y=60, so the
    // shared box is 100×200. "rise" shears y by bend·(H/2)·(−2s), i.e. −bend·H at
    // the right edge — which is −100 for the shared H=200 with bend 0.5, but only
    // −20 / −70 if each rect were warped inside its own box.
    const doc = makeDocument();
    const a = makeRect(0, 0, 100, 40, 0, 0, { fill: solid(RED) });
    const b = makeRect(0, 60, 100, 140, 0, 0, { fill: solid(RED) });
    Ops.Items.addItem(doc, a);
    Ops.Items.addItem(doc, b);

    const gid = Ops.Envelope.makeWithWarp(doc, [a.id, b.id], { style: "rise", bend: 0.5 })!;
    const rightEdgeShift = (p: PathItem, originalYs: number[]) =>
      p.geometry.anchors
        .map((an, i) => ({ an, y0: originalYs[i] }))
        .filter(({ an }) => Math.abs(an.point.x - 100) < 1e-6)
        .map(({ an, y0 }) => an.point.y - y0);

    const [pa, pb] = groupOf(doc, gid).children as PathItem[];
    // rect corner order is TL, TR, BR, BL in local space, offset by the item's
    // placement — so the right-edge anchors are indices 1 and 2.
    expect(rightEdgeShift(pa, [0, 0, 40, 40])).toEqual([-100, -100]);
    expect(rightEdgeShift(pb, [60, 60, 200, 200])).toEqual([-100, -100]);
  });

  it("re-bending re-derives from the originals instead of compounding", () => {
    const { doc, a, b } = doc3();
    const gid = Ops.Envelope.makeWithWarp(doc, [a.id, b.id], { style: "arc", bend: 0.5 })!;
    const once = JSON.stringify((groupOf(doc, gid).children[0] as PathItem).geometry);

    Ops.Envelope.updateWarp(doc, [gid], { style: "arc", bend: 0.9 });
    Ops.Envelope.updateWarp(doc, [gid], { style: "arc", bend: 0.5 });
    expect(JSON.stringify((groupOf(doc, gid).children[0] as PathItem).geometry)).toBe(once);
  });

  it("Release restores the undistorted artwork and drops the group", () => {
    const { doc, a, b } = doc3();
    const gid = Ops.Envelope.makeWithWarp(doc, [a.id, b.id], { style: "flag", bend: 0.6 })!;
    const released = Ops.Envelope.release(doc, [gid]);

    expect(released).toHaveLength(2);
    expect(Query.getItem(doc, gid)).toBeFalsy(); // group gone
    const restored = topItems(doc);
    expect(restored).toHaveLength(2);
    expect(restored.map((it) => it.type)).toEqual(["rect", "rect"]); // live shapes, unbent
    expect(Query.worldBounds(doc, restored[0].id)).toMatchObject({ x: 0, y: 0, width: 100, height: 40 });
  });

  it("Expand keeps the bent artwork and drops only the envelope metadata", () => {
    const { doc, a, b } = doc3();
    const gid = Ops.Envelope.makeWithWarp(doc, [a.id, b.id], { style: "arc", bend: 0.5 })!;
    const bent = JSON.stringify((groupOf(doc, gid).children[0] as PathItem).geometry);

    Ops.Envelope.expand(doc, [gid]);
    const g = groupOf(doc, gid);
    expect(g.envelope).toBeUndefined();
    expect(JSON.stringify((g.children[0] as PathItem).geometry)).toBe(bent);
  });

  it("keeps the envelope where the user put it", () => {
    // `sourceItems` are captured in the GROUP's local space, so re-baking them
    // yields local geometry — clearing group.transform threw away every move,
    // scale or rotation the user had applied to the envelope.
    const { doc, a, b } = doc3();
    const gid = Ops.Envelope.makeWithWarp(doc, [a.id, b.id], { style: "arc", bend: 0.5 })!;
    Ops.Transform.translateItems(doc, [gid], 250, 130);
    const moved = Query.worldBounds(doc, gid)!;
    expect(moved.x).toBeCloseTo(250, 6);

    // Re-bending must re-derive the artwork WITHOUT relocating the envelope.
    Ops.Envelope.updateWarp(doc, [gid], { style: "arc", bend: 0.9 });
    const after = Query.worldBounds(doc, gid)!;
    expect(after.x).toBeCloseTo(moved.x, 6);
    expect(after.y).toBeCloseTo(moved.y, 6);
  });

  it("hasEnvelope reports only envelope groups", () => {
    const { doc, a, b } = doc3();
    expect(Ops.Envelope.hasEnvelope(doc, [a.id, b.id])).toBe(false);
    const gid = Ops.Envelope.makeWithWarp(doc, [a.id, b.id], { style: "arc", bend: 0.5 })!;
    expect(Ops.Envelope.hasEnvelope(doc, [gid])).toBe(true);
  });
});

describe("ops.envelope — Make with Top Object", () => {
  // A square of contents under a rectangular envelope of the SAME bounds: a
  // rectangular Coons patch is the identity map, so the contents must come out
  // unchanged. That is the sharpest check that the patch math is right.
  const rectEnvelope = () => {
    const doc = makeDocument();
    const art = makeRect(10, 10, 80, 80, 0, 0, { fill: solid(RED) });
    const env = makePath(
      {
        closed: true,
        anchors: [anchor({ x: 10, y: 10 }), anchor({ x: 90, y: 10 }), anchor({ x: 90, y: 90 }), anchor({ x: 10, y: 90 })],
      },
      {},
    );
    Ops.Items.addItem(doc, art);
    Ops.Items.addItem(doc, env); // added last ⇒ frontmost ⇒ the envelope
    return { doc, art, env };
  };

  it("consumes the top object and maps the rest into it", () => {
    const { doc, art, env } = rectEnvelope();
    const gid = Ops.Envelope.makeWithTopObject(doc, [art.id, env.id])!;
    expect(gid).toBeTruthy();
    expect(Query.getItem(doc, env.id)).toBeFalsy(); // the outline was consumed

    const g = groupOf(doc, gid);
    expect(g.envelope?.kind).toBe("top-object");
    expect(g.envelope?.shape?.anchors).toHaveLength(4);
    expect(topItems(doc)).toHaveLength(1);
  });

  it("a rectangular envelope maps INTERIOR points identically too", () => {
    // The corner-only check below passes even with a broken patch, because the
    // Coons surface reproduces its boundary by construction. An anchor in the
    // MIDDLE of the box is what actually exercises the boundary blend.
    const doc = makeDocument();
    const art = makePath(
      {
        closed: true,
        anchors: [anchor({ x: 10, y: 10 }), anchor({ x: 90, y: 10 }), anchor({ x: 50, y: 50 }), anchor({ x: 90, y: 90 }), anchor({ x: 10, y: 90 })],
      },
      { fill: solid(RED) },
    );
    const env = makePath(
      { closed: true, anchors: [anchor({ x: 10, y: 10 }), anchor({ x: 90, y: 10 }), anchor({ x: 90, y: 90 }), anchor({ x: 10, y: 90 })] },
      {},
    );
    Ops.Items.addItem(doc, art);
    Ops.Items.addItem(doc, env);

    const gid = Ops.Envelope.makeWithTopObject(doc, [art.id, env.id])!;
    const out = (groupOf(doc, gid).children[0] as PathItem).geometry;
    const mid = out.anchors[2].point;
    expect(mid.x).toBeCloseTo(50, 3);
    expect(mid.y).toBeCloseTo(50, 3);
  });

  it("maps interior points correctly whichever way the envelope outline winds", () => {
    // Same envelope, wound counter-clockwise (TL → BL → BR → TR).
    const doc = makeDocument();
    const art = makePath(
      {
        closed: true,
        anchors: [anchor({ x: 10, y: 10 }), anchor({ x: 90, y: 10 }), anchor({ x: 50, y: 50 }), anchor({ x: 90, y: 90 }), anchor({ x: 10, y: 90 })],
      },
      { fill: solid(RED) },
    );
    const env = makePath(
      { closed: true, anchors: [anchor({ x: 10, y: 10 }), anchor({ x: 10, y: 90 }), anchor({ x: 90, y: 90 }), anchor({ x: 90, y: 10 })] },
      {},
    );
    Ops.Items.addItem(doc, art);
    Ops.Items.addItem(doc, env);

    const gid = Ops.Envelope.makeWithTopObject(doc, [art.id, env.id])!;
    const mid = (groupOf(doc, gid).children[0] as PathItem).geometry.anchors[2].point;
    expect(mid.x).toBeCloseTo(50, 3);
    expect(mid.y).toBeCloseTo(50, 3);
  });

  it("a rectangular envelope over the same bounds is the identity map", () => {
    const { doc, art, env } = rectEnvelope();
    const gid = Ops.Envelope.makeWithTopObject(doc, [art.id, env.id])!;
    const out = (groupOf(doc, gid).children[0] as PathItem).geometry;
    const xs = out.anchors.map((a) => a.point.x).sort((p, q) => p - q);
    const ys = out.anchors.map((a) => a.point.y).sort((p, q) => p - q);
    expect(xs[0]).toBeCloseTo(10, 3);
    expect(xs[xs.length - 1]).toBeCloseTo(90, 3);
    expect(ys[0]).toBeCloseTo(10, 3);
    expect(ys[ys.length - 1]).toBeCloseTo(90, 3);
  });

  it("a bowed envelope pushes the interior outward with its boundary", () => {
    const doc = makeDocument();
    const art = makeRect(10, 10, 80, 80, 0, 0, { fill: solid(RED) });
    // Same corners, but the top edge bows UP (a control handle lifting its middle).
    const env = makePath(
      {
        closed: true,
        anchors: [
          anchor({ x: 10, y: 10 }, { x: 0, y: 0 }, { x: 20, y: -40 }),
          anchor({ x: 90, y: 10 }, { x: -20, y: -40 }, { x: 0, y: 0 }),
          anchor({ x: 90, y: 90 }),
          anchor({ x: 10, y: 90 }),
        ],
      },
      {},
    );
    Ops.Items.addItem(doc, art);
    Ops.Items.addItem(doc, env);

    const gid = Ops.Envelope.makeWithTopObject(doc, [art.id, env.id])!;
    const out = (groupOf(doc, gid).children[0] as PathItem).geometry;
    const topY = Math.min(...out.anchors.map((a) => a.point.y));
    expect(topY).toBeLessThan(10); // the art's top edge followed the bow upward
  });

  it("Release restores the contents AND puts the envelope outline back", () => {
    const { doc, art, env } = rectEnvelope();
    const gid = Ops.Envelope.makeWithTopObject(doc, [art.id, env.id])!;
    Ops.Envelope.release(doc, [gid]);

    const items = topItems(doc);
    expect(items).toHaveLength(2); // the art + the outline again
    expect(items.some((it) => it.type === "rect")).toBe(true);
    expect(items.some((it) => it.type === "path")).toBe(true);
  });

  it("needs at least two objects", () => {
    const { doc, env } = rectEnvelope();
    expect(Ops.Envelope.makeWithTopObject(doc, [env.id])).toBeNull();
  });
});
