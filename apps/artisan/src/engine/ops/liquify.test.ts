// ─────────────────────────────────────────────────────────────
// ops/liquify.test — Liquify distortions (Warp/Twirl/Pucker/Bloat/Scallop)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator liquify tools. Warp drags points in a direction;
// Twirl rotates them around the brush; Pucker pulls them toward the centre; Bloat
// pushes them away; Scallop carves alternating in/out lobes. The brush has a
// circular falloff (t = 1 − dist/radius).

import { describe, it, expect } from "vitest";
import { makeCompound, makeDocument, makeRect, makePath, makeAnchor as anchor, Ops, Query, solid, rgba } from "../index";

const L = Ops.Liquify;

describe("ops.liquify — distortion functions", () => {
  it("warpFn displaces by delta · t · strength", () => {
    expect(L.warpFn({ x: 10, y: 4 }, 1)({ x: 0, y: 0 }, { x: 0, y: 0 }, 1)).toEqual({ x: 10, y: 4 });
    expect(L.warpFn({ x: 10, y: 0 }, 1)({ x: 0, y: 0 }, { x: 0, y: 0 }, 0.5)).toEqual({ x: 5, y: 0 });
  });
  it("puckerFn pulls toward the centre", () => {
    expect(L.puckerFn(0.5)({ x: 10, y: 0 }, { x: 0, y: 0 }, 1)).toEqual({ x: 5, y: 0 });
  });
  it("bloatFn pushes away from the centre", () => {
    expect(L.bloatFn(0.5)({ x: 10, y: 0 }, { x: 0, y: 0 }, 1)).toEqual({ x: 15, y: 0 });
  });
  it("twirlFn rotates around the centre", () => {
    const r = L.twirlFn(Math.PI / 2)({ x: 1, y: 0 }, { x: 0, y: 0 }, 1);
    expect(r.x).toBeCloseTo(0);
    expect(r.y).toBeCloseTo(1);
  });
  it("scallopFn pushes OUTWARD at a lobe peak (distinct from pucker's inward pull)", () => {
    const ang = Math.PI / 10; // lobes=5 → sin(ang·5) = sin(π/2) = +1 → outward
    const P = { x: Math.cos(ang) * 10, y: Math.sin(ang) * 10 };
    const out = L.scallopFn(0.5, 5)(P, { x: 0, y: 0 }, 1);
    expect(Math.hypot(out.x, out.y)).toBeGreaterThan(10); // farther from the centre
  });
});

describe("ops.liquify — the op (radius + falloff)", () => {
  it("only affects anchors inside the radius, with falloff", () => {
    const doc = makeDocument();
    const p = makePath({ closed: false, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 50, y: 0 }), anchor({ x: 200, y: 0 })] });
    Ops.Items.addItem(doc, p);
    L.liquify(doc, p.id, { x: 0, y: 0 }, 60, L.bloatFn(0.5));
    const a = (Query.getItem(doc, p.id) as { geometry: { anchors: { point: { x: number; y: number } }[] } }).geometry.anchors.map((x) => x.point);
    expect(a[0]).toEqual({ x: 0, y: 0 }); // at the centre → (pt−c)=0, no move
    expect(a[1].x).toBeCloseTo(54.17, 1); // d=50<60 → bloated by t=1−50/60
    expect(a[2]).toEqual({ x: 200, y: 0 }); // d=200>60 → untouched
  });

  it("is a no-op on a non-path item", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(rgba(220, 0, 0)) });
    Ops.Items.addItem(doc, r);
    L.liquify(doc, r.id, { x: 20, y: 20 }, 100, L.bloatFn(0.5));
    expect(Query.getItem(doc, r.id)!.type).toBe("rect"); // shape untouched
  });

  it("deforms every subpath of a compound", () => {
    const doc = makeDocument();
    const compound = makeCompound([
      { closed: false, anchors: [anchor({ x: 10, y: 0 })] },
      { closed: false, anchors: [anchor({ x: 20, y: 0 })] },
    ]);
    Ops.Items.addItem(doc, compound);

    L.liquify(doc, compound.id, { x: 0, y: 0 }, 100, L.bloatFn(0.5));

    expect(compound.subpaths.map((path) => path.anchors[0].point.x)).toEqual([14.5, 28]);
  });

  const square = () => makePath({ closed: true, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 100, y: 0 }), anchor({ x: 100, y: 100 }), anchor({ x: 0, y: 100 })] });
  const w = (doc: ReturnType<typeof makeDocument>, id: string) => Query.worldBounds(doc, id)!;

  it("pucker shrinks a shape; bloat grows it (around the brush centre)", () => {
    const before = (() => {
      const d = makeDocument();
      const p = square();
      Ops.Items.addItem(d, p);
      return w(d, p.id).width;
    })();

    const dp = makeDocument();
    const pp = square();
    Ops.Items.addItem(dp, pp);
    L.liquify(dp, pp.id, { x: 50, y: 50 }, 120, L.puckerFn(0.5));
    expect(w(dp, pp.id).width).toBeLessThan(before);

    const db = makeDocument();
    const pb = square();
    Ops.Items.addItem(db, pb);
    L.liquify(db, pb.id, { x: 50, y: 50 }, 120, L.bloatFn(0.5));
    expect(w(db, pb.id).width).toBeGreaterThan(before);
  });

  it("warp shifts a shape uniformly in the drag direction (all corners equidistant)", () => {
    const doc = makeDocument();
    const p = square();
    Ops.Items.addItem(doc, p);
    const before = w(doc, p.id);
    L.liquify(doc, p.id, { x: 50, y: 50 }, 120, L.warpFn({ x: 30, y: 0 }, 1));
    const after = w(doc, p.id);
    expect(after.x).toBeGreaterThan(before.x); // shifted right
    expect(after.width).toBeCloseTo(before.width); // uniform shift, width preserved
  });
});
