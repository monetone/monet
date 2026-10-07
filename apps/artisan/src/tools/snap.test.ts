// ─────────────────────────────────────────────────────────────
// tools/snap.test — Shift-constrained move & angle snapping (parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator — Shift while dragging constrains movement to
// multiples of 45° (horizontal, vertical, AND the two diagonals), projecting the
// drag onto the chosen axis. constrainAngle rounds an angle to a 45° increment.

import { describe, it, expect } from "vitest";
import { constrainAxis, constrainAngle, snapPoint } from "./snap";
import { ArtisanStore, makeDocument, makeRect, solid, rgba, type EditorState } from "../engine";

const stateWith = (snap: Partial<EditorState["snap"]>, grid: Partial<EditorState["grid"]>): EditorState => {
  const s = new ArtisanStore().getState();
  return { ...s, snap: { ...s.snap, ...snap }, grid: { ...s.grid, ...grid } };
};

// A doc with one rect at (0,0)-(100,100); corner anchors at the four corners.
// toObject (edge snap) defaults OFF so the anchor-snap tests stay isolated.
const rectState = (opts: { selectRect?: boolean; toPoint?: boolean; toObject?: boolean; enabled?: boolean; zoom?: number; hidden?: boolean } = {}): EditorState => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const r = makeRect(0, 0, 100, 100, 0, 0, { fill: solid(rgba(200, 0, 0)) });
  if (opts.hidden) r.visible = false;
  doc.layers[0].items.push(r);
  store.replaceDoc(doc, { markClean: true });
  const base = store.getState();
  return {
    ...base,
    selection: opts.selectRect ? [r.id] : [],
    snap: { ...base.snap, toGrid: false, toPoint: opts.toPoint ?? true, toObject: opts.toObject ?? false, enabled: opts.enabled ?? true },
    view: { ...base.view, zoom: opts.zoom ?? 1 },
  };
};

describe("snap.constrainAxis — 45° move constraint", () => {
  it("snaps a near-horizontal drag to pure horizontal", () => {
    const { dx, dy } = constrainAxis(40, 6); // ~8.5° → 0°
    expect(dy).toBe(0);
    expect(dx).toBeCloseTo(40);
  });

  it("snaps a near-vertical drag to pure vertical", () => {
    const { dx, dy } = constrainAxis(6, 40); // ~81° → 90°
    expect(dx).toBe(0);
    expect(dy).toBeCloseTo(40);
  });

  it("keeps a ~45° drag on the diagonal with equal components", () => {
    const { dx, dy } = constrainAxis(60, 50); // ~39.8° → 45°
    expect(dx).toBeCloseTo(dy); // equal magnitude ⇒ exact diagonal
    expect(dx).toBeGreaterThan(0);
    expect(dy).toBeGreaterThan(0);
  });

  it("handles the other diagonals (signs preserved)", () => {
    const up = constrainAxis(-50, 50); // 135° → up-left diagonal
    expect(up.dx).toBeCloseTo(-up.dy); // dx negative, dy positive, equal magnitude
    expect(up.dx).toBeLessThan(0);
  });

  it("returns zero for no movement", () => {
    expect(constrainAxis(0, 0)).toEqual({ dx: 0, dy: 0 });
  });

  it("an exact-45° drag is unchanged (projection is the identity on its own axis)", () => {
    const { dx, dy } = constrainAxis(30, 30);
    expect(dx).toBeCloseTo(30);
    expect(dy).toBeCloseTo(30);
  });
});

describe("snap.snapPoint — Snap to Grid (View ▸ Snap to Grid)", () => {
  it("snaps the pointer to the nearest grid intersection when enabled", () => {
    const st = stateWith({ enabled: true, toGrid: true }, { size: 50 });
    expect(snapPoint(st, { x: 137, y: 162 })).toEqual({ x: 150, y: 150 });
    expect(snapPoint(st, { x: 124, y: 176 })).toEqual({ x: 100, y: 200 });
  });

  it("does not snap when Snap to Grid is off", () => {
    const st = stateWith({ enabled: true, toGrid: false }, { size: 50 });
    expect(snapPoint(st, { x: 137, y: 162 })).toEqual({ x: 137, y: 162 });
  });

  it("does not snap when the master Snap toggle is off", () => {
    const st = stateWith({ enabled: false, toGrid: true }, { size: 50 });
    expect(snapPoint(st, { x: 137, y: 162 })).toEqual({ x: 137, y: 162 });
  });

  it("does not snap when the grid size is 0", () => {
    const st = stateWith({ enabled: true, toGrid: true }, { size: 0 });
    expect(snapPoint(st, { x: 137, y: 162 })).toEqual({ x: 137, y: 162 });
  });
});

describe("snap.snapPoint — Smart Guides snap to anchor point", () => {
  it("snaps the pointer to a nearby object anchor (within tolerance)", () => {
    const st = rectState();
    expect(snapPoint(st, { x: 3, y: 4 })).toEqual({ x: 0, y: 0 }); // near top-left corner
    expect(snapPoint(st, { x: 98, y: 2 })).toEqual({ x: 100, y: 0 }); // near top-right corner
  });

  it("does not snap when the pointer is far from every anchor", () => {
    expect(snapPoint(rectState(), { x: 50, y: 50 })).toEqual({ x: 50, y: 50 }); // centre
  });

  it("does not snap when Smart Guides (toPoint) is off", () => {
    expect(snapPoint(rectState({ toPoint: false }), { x: 3, y: 4 })).toEqual({ x: 3, y: 4 });
  });

  it("excludes the SELECTED object so a dragged object never snaps to itself", () => {
    expect(snapPoint(rectState({ selectRect: true }), { x: 3, y: 4 })).toEqual({ x: 3, y: 4 });
  });

  it("ignores hidden objects as snap targets", () => {
    expect(snapPoint(rectState({ hidden: true }), { x: 3, y: 4 })).toEqual({ x: 3, y: 4 });
  });

  it("scales the tolerance with zoom (screen px ÷ zoom = world units)", () => {
    // 10 world-units from the corner: snaps when zoomed OUT (tol 12), not when zoomed IN (tol 3)
    expect(snapPoint(rectState({ zoom: 0.5 }), { x: 10, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(snapPoint(rectState({ zoom: 2 }), { x: 10, y: 0 })).toEqual({ x: 10, y: 0 });
  });
});

describe("snap.snapPoint — Smart Guides snap to object EDGE (toObject)", () => {
  it("snaps the pointer onto a nearby path edge (between anchors)", () => {
    const st = rectState({ toPoint: false, toObject: true });
    const left = snapPoint(st, { x: 3, y: 50 }); // 3px right of the left edge
    expect(left.x).toBeCloseTo(0); // (edge snap projects onto the bezier ⇒ tiny FP)
    expect(left.y).toBeCloseTo(50);
    const bottom = snapPoint(st, { x: 50, y: 97 }); // 3px above the bottom edge
    expect(bottom.x).toBeCloseTo(50);
    expect(bottom.y).toBeCloseTo(100);
  });

  it("does not snap when the pointer is too far from any edge", () => {
    const st = rectState({ toPoint: false, toObject: true });
    expect(snapPoint(st, { x: 50, y: 50 })).toEqual({ x: 50, y: 50 }); // 50px from every edge
  });

  it("does not snap when snap-to-object is off", () => {
    const st = rectState({ toPoint: false, toObject: false });
    expect(snapPoint(st, { x: 3, y: 50 })).toEqual({ x: 3, y: 50 });
  });

  it("anchors take priority over edges (a corner wins over its edges)", () => {
    const st = rectState({ toPoint: true, toObject: true });
    expect(snapPoint(st, { x: 3, y: 4 })).toEqual({ x: 0, y: 0 }); // corner anchor, not (0,4) on the edge
  });

  it("excludes the selected object's edges", () => {
    const st = rectState({ selectRect: true, toPoint: false, toObject: true });
    expect(snapPoint(st, { x: 3, y: 50 })).toEqual({ x: 3, y: 50 });
  });
});

describe("snap.constrainAngle — 45° rounding", () => {
  it("rounds to the nearest 45° increment", () => {
    expect(constrainAngle(0.2)).toBeCloseTo(0); // ~11° → 0
    expect(constrainAngle(Math.PI / 4 + 0.05)).toBeCloseTo(Math.PI / 4); // ~48° → 45°
    expect(constrainAngle(Math.PI / 2 - 0.05)).toBeCloseTo(Math.PI / 2); // ~87° → 90°
  });
});

describe("snapPoint — Snap to Pixel", () => {
  it("rounds to whole document units when enabled", () => {
    const st = stateWith({ enabled: true, toGrid: false, toPoint: false, toObject: false, toPixel: true }, {});
    expect(snapPoint(st, { x: 12.4, y: -3.6 })).toEqual({ x: 12, y: -4 });
  });

  it("is off by default and leaves the point alone", () => {
    const st = stateWith({ enabled: true, toGrid: false, toPoint: false, toObject: false }, {});
    expect(snapPoint(st, { x: 12.4, y: -3.6 })).toEqual({ x: 12.4, y: -3.6 });
  });

  it("Snap to Grid still wins over Snap to Pixel", () => {
    const st = stateWith({ enabled: true, toGrid: true, toPixel: true }, { size: 50 });
    expect(snapPoint(st, { x: 12.4, y: -3.6 })).toEqual({ x: 0, y: -0 });
  });

  it("does nothing while snapping is off entirely", () => {
    const st = stateWith({ enabled: false, toPixel: true }, {});
    expect(snapPoint(st, { x: 12.4, y: -3.6 })).toEqual({ x: 12.4, y: -3.6 });
  });
});
