// ─────────────────────────────────────────────────────────────
// ops/align.test — Align & Distribute (Illustrator Align panel parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator "Align and distribute objects".
//   Align (6): left · center-h · right · top · middle-v · bottom — each snaps
//     the object's edge/centre to the reference rect (selection OR artboard).
//   Distribute spacing (2): dist-h · dist-v — equal GAPS across the reference
//     rect (selection bounds, or the whole artboard when "Align to Artboard").

import { describe, it, expect } from "vitest";
import { makeDocument, makeRect, Ops, Query } from "../index";
import type { Rect } from "../index";

const build = (rects: [number, number, number, number][]) => {
  const doc = makeDocument();
  const ids: string[] = [];
  for (const [x, y, w, h] of rects) {
    const item = makeRect(x, y, w, h);
    Ops.Items.addItem(doc, item);
    ids.push(item.id);
  }
  return { doc, ids };
};

const wb = (doc: ReturnType<typeof makeDocument>, id: string) => Query.worldBounds(doc, id)!;
const selBounds = (doc: ReturnType<typeof makeDocument>, ids: string[]): Rect => Query.selectionBounds(doc, ids)!;
const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 3);

// Three rects with distinct positions + sizes; selection bounds = [0,140]×[0,240].
const threeRects = () => build([
  [0, 0, 40, 20],
  [100, 50, 20, 60],
  [60, 200, 80, 40],
]);

describe("ops.align — align to selection bounds", () => {
  it("left snaps every left edge to the selection's left", () => {
    const { doc, ids } = threeRects();
    Ops.Align.align(doc, ids, "left", selBounds(doc, ids));
    for (const id of ids) near(wb(doc, id).x, 0);
  });

  it("right snaps every right edge to the selection's right", () => {
    const { doc, ids } = threeRects();
    const ref = selBounds(doc, ids); // x=0,width=140
    Ops.Align.align(doc, ids, "right", ref);
    for (const id of ids) near(wb(doc, id).x + wb(doc, id).width, ref.x + ref.width);
  });

  it("center-h centres every object horizontally", () => {
    const { doc, ids } = threeRects();
    const ref = selBounds(doc, ids);
    const cx = ref.x + ref.width / 2; // 70
    Ops.Align.align(doc, ids, "center-h", ref);
    for (const id of ids) near(wb(doc, id).x + wb(doc, id).width / 2, cx);
  });

  it("top / middle-v / bottom snap vertical edges & centres", () => {
    const ref = { x: 0, y: 0, width: 140, height: 240 };
    {
      const { doc, ids } = threeRects();
      Ops.Align.align(doc, ids, "top", ref);
      for (const id of ids) near(wb(doc, id).y, 0);
    }
    {
      const { doc, ids } = threeRects();
      Ops.Align.align(doc, ids, "bottom", ref);
      for (const id of ids) near(wb(doc, id).y + wb(doc, id).height, 240);
    }
    {
      const { doc, ids } = threeRects();
      Ops.Align.align(doc, ids, "middle-v", ref);
      for (const id of ids) near(wb(doc, id).y + wb(doc, id).height / 2, 120);
    }
  });
});

describe("ops.align — align to artboard", () => {
  it("aligns a single object to the artboard edges/centre", () => {
    const ab: Rect = { x: 0, y: 0, width: 300, height: 200 };
    {
      const { doc, ids } = build([[50, 50, 20, 20]]);
      Ops.Align.align(doc, ids, "left", ab);
      near(wb(doc, ids[0]).x, 0);
    }
    {
      const { doc, ids } = build([[50, 50, 20, 20]]);
      Ops.Align.align(doc, ids, "right", ab);
      near(wb(doc, ids[0]).x, 280); // 300 - 20
    }
    {
      const { doc, ids } = build([[50, 50, 20, 20]]);
      Ops.Align.align(doc, ids, "center-h", ab);
      near(wb(doc, ids[0]).x, 140); // 150 - 10
    }
  });
});

describe("ops.align — distribute spacing (selection)", () => {
  it("equalises horizontal gaps, leaving the extremes fixed", () => {
    // a[0,20] b[40,80] c[200,220]; sumSizes=80; extent=220; gap=70.
    const { doc, ids } = build([
      [0, 0, 20, 20],
      [40, 0, 40, 20],
      [200, 0, 20, 20],
    ]);
    const [a, b, c] = ids;
    Ops.Align.align(doc, ids, "dist-h", selBounds(doc, ids));
    near(wb(doc, a).x, 0); // leftmost unchanged
    near(wb(doc, c).x, 200); // rightmost unchanged
    near(wb(doc, b).x, 90); // 0 + 20 + 70
    const gap1 = wb(doc, b).x - (wb(doc, a).x + wb(doc, a).width);
    const gap2 = wb(doc, c).x - (wb(doc, b).x + wb(doc, b).width);
    near(gap1, gap2);
    near(gap1, 70);
  });

  it("equalises vertical gaps", () => {
    const { doc, ids } = build([
      [0, 0, 20, 20],
      [0, 40, 20, 40],
      [0, 200, 20, 20],
    ]);
    const [a, b, c] = ids;
    Ops.Align.align(doc, ids, "dist-v", selBounds(doc, ids));
    near(wb(doc, a).y, 0);
    near(wb(doc, c).y, 200);
    const gap1 = wb(doc, b).y - (wb(doc, a).y + wb(doc, a).height);
    const gap2 = wb(doc, c).y - (wb(doc, b).y + wb(doc, b).height);
    near(gap1, gap2);
  });

  it("is a no-op for fewer than three objects", () => {
    const { doc, ids } = build([
      [0, 0, 20, 20],
      [200, 0, 20, 20],
    ]);
    const before = ids.map((id) => wb(doc, id).x);
    Ops.Align.align(doc, ids, "dist-h", selBounds(doc, ids));
    ids.forEach((id, i) => near(wb(doc, id).x, before[i]));
  });
});

describe("ops.align — distribute by centre", () => {
  // a[0,20] c=10 · b[40,60] c=50 · c[100,180] c=140 (c is wide). Even centres
  // ⇒ step=(140−10)/2=65, so b's centre → 75 (x=65). Distribute-SPACING would
  // instead leave b at x=50 — proving the two modes differ for unequal sizes.
  it("evens the horizontal centres, pinning the extremes", () => {
    const { doc, ids } = build([
      [0, 0, 20, 20],
      [40, 0, 20, 20],
      [100, 0, 80, 20],
    ]);
    const [a, b, c] = ids;
    Ops.Align.align(doc, ids, "dist-center-h", selBounds(doc, ids));
    const cx = (id: string) => wb(doc, id).x + wb(doc, id).width / 2;
    near(cx(a), 10); // leftmost centre pinned
    near(cx(c), 140); // rightmost centre pinned
    near(cx(b), 75); // evenly spaced centre (NOT the spacing result of 60)
    near(wb(doc, b).x, 65);
    near(cx(b) - cx(a), cx(c) - cx(b)); // equal centre-to-centre intervals
  });

  it("evens the vertical centres, pinning the extremes", () => {
    const { doc, ids } = build([
      [0, 0, 20, 20],
      [0, 40, 20, 20],
      [0, 100, 20, 80],
    ]);
    const [a, b, c] = ids;
    Ops.Align.align(doc, ids, "dist-center-v", selBounds(doc, ids));
    const cy = (id: string) => wb(doc, id).y + wb(doc, id).height / 2;
    near(cy(a), 10);
    near(cy(c), 140);
    near(cy(b), 75);
    near(cy(b) - cy(a), cy(c) - cy(b));
  });

  it("is a no-op for fewer than three objects", () => {
    const { doc, ids } = build([
      [0, 0, 20, 20],
      [200, 0, 80, 20],
    ]);
    const before = ids.map((id) => wb(doc, id).x);
    Ops.Align.align(doc, ids, "dist-center-h", selBounds(doc, ids));
    ids.forEach((id, i) => near(wb(doc, id).x, before[i]));
  });
});

describe("ops.align — distribute by edge", () => {
  const rightEdge = (doc: ReturnType<typeof makeDocument>, id: string) => wb(doc, id).x + wb(doc, id).width;
  const bottomEdge = (doc: ReturnType<typeof makeDocument>, id: string) => wb(doc, id).y + wb(doc, id).height;

  it("Horizontal Distribute Left evens the LEFT edges (≠ centre for unequal widths)", () => {
    // a.left 0 · b.left 40 (wide) · c.left 200 ⇒ step 100 ⇒ b.left → 100.
    const { doc, ids } = build([
      [0, 0, 20, 20],
      [40, 0, 80, 20],
      [200, 0, 20, 20],
    ]);
    const [a, b, c] = ids;
    Ops.Align.align(doc, ids, "dist-left", selBounds(doc, ids));
    near(wb(doc, a).x, 0); // extreme left pinned
    near(wb(doc, c).x, 200); // extreme right pinned
    near(wb(doc, b).x, 100); // evened left edge (distribute-centre would give 70)
  });

  it("Horizontal Distribute Right evens the RIGHT edges", () => {
    // a.right 20 · b.right 60 · c.right 240 ⇒ step 110 ⇒ b.right → 130 (b.x 110).
    const { doc, ids } = build([
      [0, 0, 20, 20],
      [40, 0, 20, 20],
      [200, 0, 40, 20],
    ]);
    const [a, b, c] = ids;
    Ops.Align.align(doc, ids, "dist-right", selBounds(doc, ids));
    near(rightEdge(doc, a), 20);
    near(rightEdge(doc, c), 240);
    near(rightEdge(doc, b), 130);
    near(wb(doc, b).x, 110);
  });

  it("Vertical Distribute Top evens the TOP edges", () => {
    const { doc, ids } = build([
      [0, 0, 20, 20],
      [0, 40, 20, 80],
      [0, 200, 20, 20],
    ]);
    const [a, b, c] = ids;
    Ops.Align.align(doc, ids, "dist-top", selBounds(doc, ids));
    near(wb(doc, a).y, 0); // extreme top pinned
    near(wb(doc, c).y, 200); // extreme top pinned
    near(wb(doc, b).y, 100); // b.top → 100
  });

  it("Vertical Distribute Bottom evens the BOTTOM edges", () => {
    const { doc, ids } = build([
      [0, 0, 20, 20],
      [0, 40, 20, 20],
      [0, 200, 20, 40],
    ]);
    const [a, b, c] = ids;
    Ops.Align.align(doc, ids, "dist-bottom", selBounds(doc, ids));
    near(bottomEdge(doc, a), 20); // extreme bottom pinned
    near(bottomEdge(doc, c), 240); // extreme bottom pinned
    near(bottomEdge(doc, b), 130); // b.bottom → 130 (b.y 110)
    near(wb(doc, b).y, 110);
  });

  it("distribute-left and distribute-centre give DIFFERENT results for unequal sizes", () => {
    const rects: [number, number, number, number][] = [
      [0, 0, 20, 20],
      [40, 0, 80, 20],
      [200, 0, 20, 20],
    ];
    const left = build(rects);
    Ops.Align.align(left.doc, left.ids, "dist-left", selBounds(left.doc, left.ids));
    const centre = build(rects);
    Ops.Align.align(centre.doc, centre.ids, "dist-center-h", selBounds(centre.doc, centre.ids));
    expect(wb(left.doc, left.ids[1]).x).not.toBeCloseTo(wb(centre.doc, centre.ids[1]).x, 1); // 100 vs 70
  });

  it("is a no-op for fewer than three objects", () => {
    const { doc, ids } = build([
      [0, 0, 20, 20],
      [200, 0, 80, 20],
    ]);
    const before = ids.map((id) => wb(doc, id).x);
    Ops.Align.align(doc, ids, "dist-left", selBounds(doc, ids));
    ids.forEach((id, i) => near(wb(doc, id).x, before[i]));
  });
});

describe("ops.align — distribute spacing (artboard)", () => {
  it("spreads objects across the ARTBOARD extent, not just the selection", () => {
    // Same 3 rects whose own extent is 220, but the artboard is 300 wide.
    // OLD (ref-ignoring) behaviour would keep c at x=200; the fix lands it at 280.
    const ab: Rect = { x: 0, y: 0, width: 300, height: 200 };
    const { doc, ids } = build([
      [0, 0, 20, 20],
      [40, 0, 40, 20],
      [200, 0, 20, 20],
    ]);
    const [a, b, c] = ids;
    Ops.Align.align(doc, ids, "dist-h", ab); // sumSizes=80; gap=(300-80)/2=110
    near(wb(doc, a).x, 0);
    near(wb(doc, b).x, 130); // 0 + 20 + 110
    near(wb(doc, c).x, 280); // ends flush with the artboard's right edge
    near(wb(doc, c).x + wb(doc, c).width, ab.x + ab.width);
  });
});
