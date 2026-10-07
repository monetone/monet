import { describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { ANCHOR_STRIDE } from "./paths";
import { Store } from "./store";
import { pathBounds, pathTransformMatrix, transformAnchors, transformPoints } from "./transformControls";

// A 20×10 rectangle at (10, 10) — asymmetric so flips and rotations are visible.
const RECT = [10, 10, 30, 10, 30, 20, 10, 20];
const CENTER = { cx: 20, cy: 15 };

const k = 10 * 0.5522847;
// Radius-10 circle around (20,20) as 4 smooth anchors (relative handles), the
// same fixture bezierPath.test.ts uses.
const CIRCLE = [
  30, 20, 0, -k, 0, k,
  20, 30, k, 0, -k, 0,
  10, 20, 0, k, 0, -k,
  20, 10, -k, 0, k, 0,
];

const xf = (flat: number[], t: Parameters<typeof pathTransformMatrix>[0]) =>
  transformPoints(flat, pathTransformMatrix(t, CENTER.cx, CENTER.cy));

describe("path transform geometry", () => {
  it("bounds an empty path as null", () => {
    expect(pathBounds([])).toBeNull();
    expect(pathBounds(RECT)).toEqual({ x: 10, y: 10, w: 20, h: 10 });
  });

  it("flips about the bounding-box centre without moving the box", () => {
    expect(xf(RECT, { sx: -1 })).toEqual([30, 10, 10, 10, 10, 20, 30, 20]);
    expect(xf(RECT, { sy: -1 })).toEqual([10, 20, 30, 20, 30, 10, 10, 10]);
  });

  it("scales about the centre", () => {
    const b = pathBounds(xf(RECT, { sx: 2, sy: 2 }))!;
    expect(b).toEqual({ x: 0, y: 5, w: 40, h: 20 });
  });

  it("rotates clockwise on screen (doc y grows down)", () => {
    const r = xf(RECT, { deg: 90 });
    // (10,10) is up-left of the centre → lands up-right of it.
    expect(r[0]).toBeCloseTo(25);
    expect(r[1]).toBeCloseTo(5);
    const b = pathBounds(r)!;
    expect(b.w).toBeCloseTo(10);
    expect(b.h).toBeCloseTo(20);
  });

  it("skews by a shear angle and moves after the linear part", () => {
    // 45° horizontal shear: x shifts by (y − cy).
    const s = xf(RECT, { skewH: 45 });
    expect(s[0]).toBeCloseTo(10 + (10 - 15));
    expect(s[4]).toBeCloseTo(30 + (20 - 15));
    for (let i = 1; i < s.length; i += 2) expect(s[i]).toBeCloseTo(RECT[i]); // y untouched by a horizontal shear
    expect(xf(RECT, { tx: 7, ty: -3 })).toEqual([17, 7, 37, 7, 37, 17, 17, 17]);
  });
});

describe("transformAnchors", () => {
  it("moves anchor points but leaves relative handles unmoved by a translation", () => {
    const m = pathTransformMatrix({ tx: 5, ty: 5 }, 20, 20);
    const out = transformAnchors(CIRCLE, m);
    expect(out[0]).toBeCloseTo(35);
    expect(out[1]).toBeCloseTo(25);
    expect(out[2]).toBeCloseTo(CIRCLE[2]); // handles are vectors — translation must not touch them
    expect(out[3]).toBeCloseTo(CIRCLE[3]);
  });

  it("applies the linear part to handles, so a scaled circle stays a true ellipse", () => {
    const m = pathTransformMatrix({ sx: 2, sy: 1 }, 20, 20);
    const out = transformAnchors(CIRCLE, m);
    expect(out.length).toBe(4 * ANCHOR_STRIDE);
    expect(out[0]).toBeCloseTo(40); // (30,20) → 20 + 2·10
    expect(out[3]).toBeCloseTo(-k); // vertical handle keeps its length under sy = 1
    expect(out[5]).toBeCloseTo(k);
    // The second anchor's horizontal handles doubled with sx.
    expect(out[ANCHOR_STRIDE + 2]).toBeCloseTo(2 * k);
  });
});

describe("Store — Edit ▸ Free Transform Path", () => {
  function storeWith() {
    // `engine` left undefined = wasm not loaded, which is enough for the work
    // path (pure state) and keeps setTool off the brush/text engine calls.
    const eng = { set_mask_reveal: vi.fn() };
    const client = { engine: undefined, e: eng, commit: vi.fn(() => true), onCommit: null };
    return new Store(client as never);
  }

  it("only targets the path when a path tool holds one", () => {
    const store = storeWith();
    expect(store.pathIsTransformTarget()).toBe(false); // no path
    store.setPenPath(RECT);
    store.setTool("move");
    expect(store.pathIsTransformTarget()).toBe(false); // path, but a pixel tool
    store.setTool("pen");
    expect(store.pathIsTransformTarget()).toBe(true);
    store.setTool("pathselect");
    expect(store.pathIsTransformTarget()).toBe(true);
  });

  it("refuses (so the caller falls back to the layer) when there is no path", () => {
    const store = storeWith();
    expect(store.transformWorkPath({ deg: 90 })).toBe(false);
    expect(store.repeatWorkPathTransform()).toBe(false);
  });

  it("transforms a corner work path in place", () => {
    const store = storeWith();
    store.setPenPath(RECT);
    expect(store.transformWorkPath({ sx: 2, sy: 2 })).toBe(true);
    expect(pathBounds(store.state.penPath)).toEqual({ x: 0, y: 5, w: 40, h: 20 });
    expect(store.state.penAnchors).toEqual([]);
  });

  it("transforms a bezier work path in its anchor form and re-flattens it", () => {
    const store = storeWith();
    store.setPenAnchors(CIRCLE);
    const before = store.state.penPath.length;
    expect(store.transformWorkPath({ sx: 2, sy: 2 })).toBe(true);
    expect(store.state.penAnchors[0]).toBeCloseTo(40); // anchors scaled about (20,20)
    expect(store.state.penPath.length).toBeGreaterThanOrEqual(before); // still a flattened curve, not a 4-gon
    for (let i = 0; i + 1 < store.state.penPath.length; i += 2) {
      // Every flattened vertex sits on the radius-20 circle — curves survived.
      expect(Math.abs(Math.hypot(store.state.penPath[i] - 20, store.state.penPath[i + 1] - 20) - 20)).toBeLessThan(0.15);
    }
  });

  it("Transform ▸ Again replays the last path transform, and only for a path target", () => {
    const store = storeWith();
    store.setPenPath(RECT);
    store.setTool("pen");
    store.transformWorkPath({ tx: 5 });
    expect(store.repeatWorkPathTransform()).toBe(true);
    expect(pathBounds(store.state.penPath)!.x).toBe(20); // 10 + 5 + 5
    store.setTool("move");
    expect(store.repeatWorkPathTransform()).toBe(false); // falls through to the layer transform
  });
});
