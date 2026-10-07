// ─────────────────────────────────────────────────────────────
// ops/warp.test — Effect ▸ Warp ▸ Arc / Arc Lower / Arc Upper (Illustrator parity)
// ─────────────────────────────────────────────────────────────
// Reference: Illustrator Warp — bends a shape inside its bbox along a parabola.
// dy = bend·(h/2)·(1−u²)·weight; u = horizontal pos in [−1,1]; weight = 1 (arc),
// v (arc-lower), 1−v (arc-upper), v = vertical pos in [0,1]. Left/right edges
// (u = ±1) are pinned; the horizontal centre (u = 0) moves the most.

import { describe, it, expect } from "vitest";
import { makeDocument, makePath, makeCompound, makeRect, makeAnchor as anchor, Ops, Query, solid, rgba } from "../index";
import type { PathItem } from "../index";

// A unit diamond: a vertex at the horizontal centre top & bottom (u=0) plus the
// two side vertices (u=±1). bbox = {0,0,100,100}, cx=50, so bend 0.5 ⇒ a centre
// displacement of 0.5·50·1 = 25.
const diamond = () => ({
  closed: true,
  anchors: [anchor({ x: 50, y: 0 }), anchor({ x: 100, y: 50 }), anchor({ x: 50, y: 100 }), anchor({ x: 0, y: 50 })],
});
const geomOf = (doc: ReturnType<typeof makeDocument>, id: string) => (Query.getItem(doc, id) as PathItem).geometry;
// Round to 2 dp; the `+ 0` collapses floating-point −0 (e.g. sin(π)·k) to +0 so
// toEqual matches the integer expectations.
const r2 = (n: number) => Math.round(n * 100) / 100 + 0;
const pts = (doc: ReturnType<typeof makeDocument>, id: string) => geomOf(doc, id).anchors.map((a) => ({ x: r2(a.point.x), y: r2(a.point.y) }));

describe("ops.warp.warp — Arc", () => {
  it("bows the whole shape: both centre vertices shift down by bend·h/2, sides pinned", () => {
    const doc = makeDocument();
    const p = makePath(diamond());
    Ops.Items.addItem(doc, p);
    const ids = Ops.Warp.warp(doc, [p.id], { style: "arc", bend: 0.5 });
    expect(ids).toEqual([p.id]);
    expect(pts(doc, p.id)).toEqual([
      { x: 50, y: 25 }, // top centre (u=0) → +25
      { x: 100, y: 50 }, // right side (u=1) → pinned
      { x: 50, y: 125 }, // bottom centre (u=0) → +25
      { x: 0, y: 50 }, // left side (u=−1) → pinned
    ]);
    expect(geomOf(doc, p.id).closed).toBe(true);
  });

  it("negative bend bows the opposite way", () => {
    const doc = makeDocument();
    const p = makePath(diamond());
    Ops.Items.addItem(doc, p);
    Ops.Warp.warp(doc, [p.id], { style: "arc", bend: -0.5 });
    expect(pts(doc, p.id)[0]).toEqual({ x: 50, y: -25 }); // top centre → −25
  });
});

describe("ops.warp.warp — Arc Lower / Arc Upper weighting", () => {
  it("Arc Lower pins the top edge and bends only the bottom", () => {
    const doc = makeDocument();
    const p = makePath(diamond());
    Ops.Items.addItem(doc, p);
    Ops.Warp.warp(doc, [p.id], { style: "arc-lower", bend: 0.5 });
    const out = pts(doc, p.id);
    expect(out[0]).toEqual({ x: 50, y: 0 }); // top centre (v=0, weight 0) → unmoved
    expect(out[2]).toEqual({ x: 50, y: 125 }); // bottom centre (v=1, weight 1) → +25
  });

  it("Arc Upper pins the bottom edge and bends only the top", () => {
    const doc = makeDocument();
    const p = makePath(diamond());
    Ops.Items.addItem(doc, p);
    Ops.Warp.warp(doc, [p.id], { style: "arc-upper", bend: 0.5 });
    const out = pts(doc, p.id);
    expect(out[0]).toEqual({ x: 50, y: 25 }); // top centre (v=0, weight 1) → +25
    expect(out[2]).toEqual({ x: 50, y: 100 }); // bottom centre (v=1, weight 0) → unmoved
  });
});

describe("ops.warp.warp — Flag (sine ripple)", () => {
  // An octagon with anchors at s = 0, 0.25, 0.75, 1 across both the top and the
  // bottom edge. bbox {0,0,100,100}; Flag bend 0.5 ⇒ dy = 25·sin(2π·s).
  const octagon = () => ({
    closed: true,
    anchors: [
      anchor({ x: 0, y: 0 }),
      anchor({ x: 25, y: 0 }),
      anchor({ x: 75, y: 0 }),
      anchor({ x: 100, y: 0 }),
      anchor({ x: 100, y: 100 }),
      anchor({ x: 75, y: 100 }),
      anchor({ x: 25, y: 100 }),
      anchor({ x: 0, y: 100 }),
    ],
  });

  it("ripples along a sine across the width, uniform top-to-bottom", () => {
    const doc = makeDocument();
    const p = makePath(octagon());
    Ops.Items.addItem(doc, p);
    Ops.Warp.warp(doc, [p.id], { style: "flag", bend: 0.5 });
    expect(pts(doc, p.id)).toEqual([
      { x: 0, y: 0 }, // s=0 → sin 0
      { x: 25, y: 25 }, // s=0.25 → +25
      { x: 75, y: -25 }, // s=0.75 → −25
      { x: 100, y: 0 }, // s=1 → sin 0
      { x: 100, y: 100 }, // s=1 → 0
      { x: 75, y: 75 }, // bottom s=0.75 → −25 (same as top: uniform in y)
      { x: 25, y: 125 }, // bottom s=0.25 → +25
      { x: 0, y: 100 }, // s=0 → 0
    ]);
  });
});

describe("ops.warp.warp — Wave (double sine ripple)", () => {
  // A 12-gon with anchors at s = 0, 0.125, 0.375, 0.625, 0.875, 1 across both the
  // top and the bottom edge. bbox {0,0,100,100}; Wave bend 0.5 ⇒ dy = 25·sin(4π·s)
  // — two ripples across the width, so adjacent eighths alternate ±25.
  const wavy = () => ({
    closed: true,
    anchors: [
      anchor({ x: 0, y: 0 }),
      anchor({ x: 12.5, y: 0 }),
      anchor({ x: 37.5, y: 0 }),
      anchor({ x: 62.5, y: 0 }),
      anchor({ x: 87.5, y: 0 }),
      anchor({ x: 100, y: 0 }),
      anchor({ x: 100, y: 100 }),
      anchor({ x: 87.5, y: 100 }),
      anchor({ x: 62.5, y: 100 }),
      anchor({ x: 37.5, y: 100 }),
      anchor({ x: 12.5, y: 100 }),
      anchor({ x: 0, y: 100 }),
    ],
  });

  it("ripples twice along a sine across the width, uniform top-to-bottom", () => {
    const doc = makeDocument();
    const p = makePath(wavy());
    Ops.Items.addItem(doc, p);
    Ops.Warp.warp(doc, [p.id], { style: "wave", bend: 0.5 });
    expect(pts(doc, p.id)).toEqual([
      { x: 0, y: 0 }, // s=0 → sin 0
      { x: 12.5, y: 25 }, // s=0.125 → sin(π/2) = +1 → +25
      { x: 37.5, y: -25 }, // s=0.375 → sin(3π/2) = −1 → −25
      { x: 62.5, y: 25 }, // s=0.625 → sin(5π/2) = +1 → +25
      { x: 87.5, y: -25 }, // s=0.875 → sin(7π/2) = −1 → −25
      { x: 100, y: 0 }, // s=1 → sin 4π = 0
      { x: 100, y: 100 }, // s=1 → 0
      { x: 87.5, y: 75 }, // bottom s=0.875 → −25 (same shift as the top: uniform in y)
      { x: 62.5, y: 125 }, // bottom s=0.625 → +25
      { x: 37.5, y: 75 }, // bottom s=0.375 → −25
      { x: 12.5, y: 125 }, // bottom s=0.125 → +25
      { x: 0, y: 100 }, // s=0 → 0
    ]);
  });

  it("is a tighter ripple than Flag: Wave crosses zero where Flag still peaks", () => {
    // At s=0.25 Flag peaks (sin(π/2)=+1) but Wave is back at zero (sin(π)=0).
    const doc = makeDocument();
    const p = makePath({ closed: true, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 25, y: 0 }), anchor({ x: 100, y: 0 }), anchor({ x: 50, y: 100 })] });
    Ops.Items.addItem(doc, p);
    Ops.Warp.warp(doc, [p.id], { style: "wave", bend: 0.5 });
    expect(pts(doc, p.id)[1]).toEqual({ x: 25, y: 0 }); // s=0.25 → sin(π) = 0, no shift
  });

  it("negative bend inverts every ripple", () => {
    const doc = makeDocument();
    const p = makePath(wavy());
    Ops.Items.addItem(doc, p);
    Ops.Warp.warp(doc, [p.id], { style: "wave", bend: -0.5 });
    const out = pts(doc, p.id);
    expect(out[1]).toEqual({ x: 12.5, y: -25 }); // s=0.125 crest now dips −25 (was +25 at +bend)
    expect(out[2]).toEqual({ x: 37.5, y: 25 }); // s=0.375 trough now rises +25
  });

  it("honours a non-origin bbox: s and h/2 read from the shape's own box, not the origin", () => {
    // bbox {10,20,200,80}: cx=110, w=200, h/2=40. An anchor at s=0.125 (x=35)
    // shifts by bend·(h/2)·sin(π/2) = 0.5·40·1 = +20 — independent of the
    // {0,0,100,100} simplification the other cases lean on.
    const doc = makeDocument();
    const p = makePath({
      closed: true,
      anchors: [anchor({ x: 10, y: 20 }), anchor({ x: 35, y: 20 }), anchor({ x: 210, y: 20 }), anchor({ x: 210, y: 100 }), anchor({ x: 10, y: 100 })],
    });
    Ops.Items.addItem(doc, p);
    Ops.Warp.warp(doc, [p.id], { style: "wave", bend: 0.5 });
    expect(pts(doc, p.id)).toEqual([
      { x: 10, y: 20 }, // s=0 → 0
      { x: 35, y: 40 }, // s=0.125 → +20 (h/2=40, not 50)
      { x: 210, y: 20 }, // s=1 → 0
      { x: 210, y: 100 }, // s=1 → 0
      { x: 10, y: 100 }, // s=0 → 0
    ]);
  });
});

describe("ops.warp.warp — Rise (linear shear)", () => {
  it("pins the left edge and rises the right by the full bend·height (a parallelogram)", () => {
    const doc = makeDocument();
    const p = makePath(diamond());
    Ops.Items.addItem(doc, p);
    Ops.Warp.warp(doc, [p.id], { style: "rise", bend: 0.5 });
    // dy = bend·(h/2)·(−2s) = −50·s; bbox {0,0,100,100} ⇒ dy = −0.5·x.
    expect(pts(doc, p.id)).toEqual([
      { x: 50, y: -25 }, // top centre (s=0.5) → −25
      { x: 100, y: 0 }, // right side (s=1) → −50: rises by the full bend·h
      { x: 50, y: 75 }, // bottom centre (s=0.5) → −25
      { x: 0, y: 50 }, // left side (s=0) → pinned
    ]);
  });

  it("negative bend slants the other way (right edge drops)", () => {
    const doc = makeDocument();
    const p = makePath(diamond());
    Ops.Items.addItem(doc, p);
    Ops.Warp.warp(doc, [p.id], { style: "rise", bend: -0.5 });
    const out = pts(doc, p.id);
    expect(out[3]).toEqual({ x: 0, y: 50 }); // left still pinned
    expect(out[1]).toEqual({ x: 100, y: 100 }); // right side (s=1) → +50: drops
  });
});

describe("ops.warp.warp — Bulge (vertical swell)", () => {
  it("scales the height about the centre by 1+bend·(1−u²): centre swells, sides pin", () => {
    const doc = makeDocument();
    const p = makePath(diamond());
    Ops.Items.addItem(doc, p);
    Ops.Warp.warp(doc, [p.id], { style: "bulge", bend: 0.5 });
    expect(pts(doc, p.id)).toEqual([
      { x: 50, y: -25 }, // top centre (u=0): 50 + (0−50)·1.5 = −25
      { x: 100, y: 50 }, // right side (u=1): scale 1 → unchanged
      { x: 50, y: 125 }, // bottom centre (u=0): 50 + (100−50)·1.5 = 125
      { x: 0, y: 50 }, // left side (u=−1): unchanged
    ]);
  });
});

describe("ops.warp.warp — handles, shapes, compound & guards", () => {
  it("warps bezier handle endpoints, not just anchors", () => {
    const doc = makeDocument();
    // A square (bbox {0,0,100,100}) whose first corner sits at the side (u=−1,
    // pinned) but whose out-handle reaches the horizontal centre top (u=0), where
    // the arc is strongest. The handle's endpoint, not the anchor, gets warped.
    const g = {
      closed: true,
      anchors: [
        anchor({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 50, y: 0 }),
        anchor({ x: 100, y: 0 }),
        anchor({ x: 100, y: 100 }),
        anchor({ x: 0, y: 100 }),
      ],
    };
    const p = makePath(g);
    Ops.Items.addItem(doc, p);
    Ops.Warp.warp(doc, [p.id], { style: "arc", bend: 0.5 });
    const a = geomOf(doc, p.id).anchors;
    expect(a[0].point).toEqual({ x: 0, y: 0 }); // anchor pinned (u=−1 ⇒ dy 0)
    // handle endpoint at (50,0): u=0 ⇒ parab 1, weight 1 ⇒ dy = 0.5·50·1 = 25.
    // anchor dy = 0, so the handle's relative y picks up the full +25.
    expect(a[0].handleOut.x).toBe(50);
    expect(a[0].handleOut.y).toBeCloseTo(25, 6);
  });

  it("converts a live rect to a path and warps it", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 100, 100, 0, 0, { fill: solid(rgba(220, 0, 0)) });
    Ops.Items.addItem(doc, r);
    Ops.Warp.warp(doc, [r.id], { style: "arc-lower", bend: 0.5 });
    const it = Query.getItem(doc, r.id)!;
    expect(it.type).toBe("path");
  });

  it("warps every subpath of a compound about the shared bbox", () => {
    const doc = makeDocument();
    const comp = makeCompound([diamond()], { fill: solid(rgba(220, 0, 0)) });
    Ops.Items.addItem(doc, comp);
    Ops.Warp.warp(doc, [comp.id], { style: "arc", bend: 0.5 });
    const it = Query.getItem(doc, comp.id)!;
    if (it.type !== "compound") throw new Error("expected compound");
    expect(it.subpaths[0].anchors[0].point).toEqual({ x: 50, y: 25 });
  });

  it("is a no-op for bend 0", () => {
    const doc = makeDocument();
    const p = makePath(diamond());
    Ops.Items.addItem(doc, p);
    expect(Ops.Warp.warp(doc, [p.id], { style: "arc", bend: 0 })).toEqual([]);
    expect(pts(doc, p.id)).toEqual([
      { x: 50, y: 0 },
      { x: 100, y: 50 },
      { x: 50, y: 100 },
      { x: 0, y: 50 },
    ]);
  });

  it("leaves a degenerate (zero-width) bbox untouched — no divide-by-zero", () => {
    // A vertical line: bbox width 0, so the w≤0 guard short-circuits and every
    // point keeps its y (the shape can't be horizontally parametrised).
    const doc = makeDocument();
    const p = makePath({ closed: false, anchors: [anchor({ x: 50, y: 0 }), anchor({ x: 50, y: 100 })] });
    Ops.Items.addItem(doc, p);
    Ops.Warp.warp(doc, [p.id], { style: "wave", bend: 0.5 });
    expect(pts(doc, p.id)).toEqual([
      { x: 50, y: 0 },
      { x: 50, y: 100 },
    ]); // unchanged, no NaN
  });
});
