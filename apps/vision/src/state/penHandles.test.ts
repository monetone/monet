import { describe, expect, it } from "vitest";

import { ANCHOR_STRIDE, flattenAnchorPath, pullAnchorHandles } from "./paths";

// The Pen's click-drag gesture, exactly as CanvasView drives it: pointerdown
// pushes a corner anchor, every pointermove pulls that anchor's handles toward
// the cursor (Alt breaks the mirror). Kept here so the maths is testable without
// mounting the canvas.
// ponytail: replays the two helper calls rather than the React handlers — a
// jsdom pointer-event harness for CanvasView is the upgrade path.
type Click = { x: number; y: number; drag?: [number, number]; alt?: boolean };
function penGesture(clicks: Click[]): number[] {
  const a: number[] = [];
  for (const c of clicks) {
    const i = a.length / ANCHOR_STRIDE;
    a.push(c.x, c.y, 0, 0, 0, 0); // pointerdown: a corner anchor
    if (c.drag) pullAnchorHandles(a, i, c.drag[0], c.drag[1], !c.alt); // pointermove
  }
  return a;
}

describe("pullAnchorHandles", () => {
  it("a plain click leaves a corner anchor (both handles zero)", () => {
    expect(penGesture([{ x: 10, y: 20 }])).toEqual([10, 20, 0, 0, 0, 0]);
  });

  it("a drag pulls the out handle to the cursor and mirrors it into the in handle", () => {
    const a = penGesture([{ x: 10, y: 20, drag: [40, 26] }]);
    expect(a).toEqual([10, 20, -30, -6, 30, 6]);
  });

  it("Alt-drag breaks the pairing — only the outgoing side moves", () => {
    const a = penGesture([{ x: 10, y: 20, drag: [40, 26], alt: true }]);
    expect(a).toEqual([10, 20, 0, 0, 30, 6]);
  });

  it("is a no-op for an index outside the path (a move with no live anchor)", () => {
    const a = [0, 0, 0, 0, 0, 0];
    pullAnchorHandles(a, 3, 9, 9);
    pullAnchorHandles(a, -1, 9, 9);
    expect(a).toEqual([0, 0, 0, 0, 0, 0]);
  });
});

describe("pen-authored path flattening", () => {
  // Click (0,0) dragged to (30,−30) · click (50,50) dragged to (80,50) · click (0,50).
  const PATH = penGesture([{ x: 0, y: 0, drag: [30, -30] }, { x: 50, y: 50, drag: [80, 50] }, { x: 0, y: 50 }]);

  it("turns the dragged anchor's segments into true cubics", () => {
    const flat = flattenAnchorPath(PATH, 0.25, false);
    // Corner-only, the same three clicks flatten to exactly three points.
    expect(flattenAnchorPath(penGesture([{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 0, y: 50 }]), 0.25, false))
      .toEqual([0, 0, 50, 50, 0, 50]);
    expect(flat.length / 2).toBeGreaterThan(3); // subdivided → it really is a curve

    // Segment 0: p0 (0,0), p1 = p0 + out0 = (30,−30), p2 = A1 + in1 = (20,50),
    // p3 (50,50) → B(0.5) = (p0 + 3p1 + 3p2 + p3)/8 = (25, 13.75), a good 11 px
    // off the (0,0)→(50,50) chord. A vertex must land on it.
    const near = (px: number, py: number) => {
      let best = Infinity;
      for (let i = 0; i + 1 < flat.length; i += 2) best = Math.min(best, Math.hypot(flat[i] - px, flat[i + 1] - py));
      return best;
    };
    expect(near(25, 13.75)).toBeLessThan(0.5);
  });

  it("only the closed flattening walks the last-anchor → first-anchor segment", () => {
    const open = flattenAnchorPath(PATH, 0.25, false);
    const closed = flattenAnchorPath(PATH, 0.25);
    // Open stops on the final click (so the Pen's rubber band starts there).
    expect(open.slice(0, 2)).toEqual([0, 0]);
    expect(open.slice(-2)).toEqual([0, 50]);
    // Closed adds the wrap segment back to anchor 0 and drops its duplicate end.
    expect(closed.length).toBeGreaterThan(open.length);
    expect(closed.slice(0, open.length)).toEqual(open);
    expect(closed.slice(-2)).not.toEqual([0, 0]);
  });
});
