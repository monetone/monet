import { describe, expect, it } from "vitest";
import {
  fitFloatRect, hitPlaneEdge, hitPlaneHandle, hitVanishingPointHandle, moveVanishingPointHandle, movePlaneHandle,
  planeAt, resolvePlanes, shiftRect, tearOffPlane, uvAt, uvRectQuad, warpQuadToQuad, type VanishingPlane,
} from "./vanishingPoint";

const root = (quad: number[]): VanishingPlane => ({ quad, parent: null, edge: 0, angle: 90 });
// Shoelace sign: the winding of a quad in image space.
const winding = (q: number[]) => Math.sign([0, 1, 2, 3].reduce((s, i) => {
  const j = (i + 1) % 4;
  return s + q[i * 2] * q[j * 2 + 1] - q[j * 2] * q[i * 2 + 1];
}, 0));

describe("Vanishing Point plane helpers", () => {
  const quad = [10, 20, 110, 25, 100, 90, 15, 85];

  it("hits the nearest plane corner within a screen-stable radius", () => {
    expect(hitVanishingPointHandle(quad, 12, 21, 1)).toBe(0);
    expect(hitVanishingPointHandle(quad, 102, 88, 2)).toBe(2);
  });

  it("misses outside the handle radius", () => {
    expect(hitVanishingPointHandle(quad, 50, 50, 1)).toBeNull();
  });

  it("clamps a dragged handle to document bounds", () => {
    expect(moveVanishingPointHandle(quad, 1, 140.4, -6, 120, 100)).toEqual([
      10, 20, 120, 0, 100, 90, 15, 85,
    ]);
  });
});

describe("Vanishing Point plane list", () => {
  const flat = [0, 0, 100, 0, 100, 50, 0, 50];
  const trapezoid = [40, 60, 120, 60, 150, 110, 10, 110];

  it("picks the topmost plane under a point and hits only root handles", () => {
    const planes = [root(flat), { quad: [50, 0, 150, 0, 150, 50, 50, 50], parent: 0, edge: 1, angle: 180 }];
    expect(planeAt(planes, 20, 20)).toBe(0);
    expect(planeAt(planes, 75, 20)).toBe(1); // both contain it: the later plane is on top
    expect(planeAt(planes, 300, 300)).toBeNull();
    expect(hitPlaneHandle(planes, 101, 1, 1)).toEqual({ plane: 0, handle: 1 });
    expect(hitPlaneHandle(planes, 150, 50, 1)).toBeNull(); // a torn-off plane's corners follow its parent
    expect(hitPlaneEdge(flat, 100, 25, 1)).toBe(1);
    expect(hitPlaneEdge(flat, 50, 50, 1)).toBe(2);
    expect(hitPlaneEdge(flat, 50, 25, 1)).toBeNull();
  });

  it("continues a fronto-parallel plane flat at 180° with the parent's winding", () => {
    const child = tearOffPlane(flat, 1, 180, 400, 300)!;
    [100, 0, 200, 0, 200, 50, 100, 50].forEach((v, i) => expect(child[i]).toBeCloseTo(v, 6));
    expect(winding(child)).toBe(winding(flat));
  });

  it("puts a 180° tear-off of a perspective plane on the parent's own plane", () => {
    const child = tearOffPlane(trapezoid, 1, 180, 160, 120)!;
    const far0 = uvAt(trapezoid, child[2], child[3])!;
    const far1 = uvAt(trapezoid, child[4], child[5])!;
    expect(far0[0]).toBeCloseTo(2, 6); expect(far0[1]).toBeCloseTo(0, 6);
    expect(far1[0]).toBeCloseTo(2, 6); expect(far1[1]).toBeCloseTo(1, 6);
  });

  it("folds out of the parent plane at 90° sharing the edge exactly", () => {
    for (const edge of [0, 1, 2, 3]) {
      const child = tearOffPlane(trapezoid, edge, 90, 160, 120)!;
      expect(child).not.toBeNull();
      const flatChild = tearOffPlane(trapezoid, edge, 180, 160, 120)!;
      const shared = [trapezoid.slice(edge * 2, edge * 2 + 2), trapezoid.slice(((edge + 1) % 4) * 2, ((edge + 1) % 4) * 2 + 2)];
      const ends = [child.slice(0, 2), child.slice(6, 8)];
      expect(ends.sort()).toEqual(shared.sort());
      expect(Math.hypot(child[2] - flatChild[2], child[3] - flatChild[3])).toBeGreaterThan(1);
      expect(winding(child)).toBe(winding(trapezoid));
    }
  });

  it("refuses a fold with no plane to show", () => {
    expect(tearOffPlane(trapezoid, 0, 0, 160, 120)).toBeNull();
    expect(tearOffPlane(trapezoid, 0, 360, 160, 120)).toBeNull();
    expect(tearOffPlane(trapezoid, 0, Number.NaN, 160, 120)).toBeNull();
    expect(tearOffPlane([0, 0, 0, 0, 0, 0, 0, 0], 0, 90, 160, 120)).toBeNull();
  });

  it("keeps a torn-off plane linked when its root corner moves", () => {
    const planes = [root(trapezoid), { quad: tearOffPlane(trapezoid, 1, 90, 160, 120)!, parent: 0, edge: 1, angle: 90 }];
    const moved = movePlaneHandle(planes, 0, 1, 124, 50, 160, 120);
    expect(moved[0].quad.slice(2, 4)).toEqual([124, 50]);
    expect([moved[1].quad.slice(0, 2), moved[1].quad.slice(6, 8)]).toContainEqual([124, 50]);
    expect(planes[0].quad.slice(2, 4)).toEqual([120, 60]); // the input list is not mutated
    expect(resolvePlanes(planes, 160, 120)[1].quad).toEqual(planes[1].quad);
  });
});

describe("Vanishing Point floats", () => {
  it("warps a solid image to exactly an axis-aligned destination", () => {
    const src = new Uint8ClampedArray(4 * 4 * 4).fill(200);
    const out = warpQuadToQuad(src, 4, 4, [0, 0, 4, 0, 4, 4, 0, 4], [2, 3, 12, 3, 12, 9, 2, 9], 20, 20)!;
    expect({ x: out.x, y: out.y, w: out.w, h: out.h }).toEqual({ x: 2, y: 3, w: 10, h: 6 });
    expect(out.rgba.every((v) => v === 200)).toBe(true);
  });

  it("leaves pixels outside a perspective destination transparent and clips to the canvas", () => {
    const src = new Uint8ClampedArray(4 * 4 * 4).fill(255);
    const out = warpQuadToQuad(src, 4, 4, [0, 0, 4, 0, 4, 4, 0, 4], [8, 0, 12, 0, 20, 10, 0, 10], 16, 16)!;
    expect({ x: out.x, w: out.w }).toEqual({ x: 0, w: 16 });
    expect(out.rgba[3]).toBe(0); // top-left of the bbox is outside the trapezoid
    expect(out.rgba[(5 * out.w + 10) * 4 + 3]).toBe(255);
    expect(warpQuadToQuad(src, 4, 4, [0, 0, 4, 0, 4, 4, 0, 4], [30, 30, 40, 30, 40, 40, 30, 40], 16, 16)).toBeNull();
  });

  it("maps source quadrants to the matching destination quadrants", () => {
    const colors = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0]]; // TL TR BL BR
    const src = new Uint8ClampedArray(4 * 4 * 4);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const c = colors[(y < 2 ? 0 : 2) + (x < 2 ? 0 : 1)];
      src.set([...c, 255], (y * 4 + x) * 4);
    }
    const out = warpQuadToQuad(src, 4, 4, [0, 0, 4, 0, 4, 4, 0, 4], [10, 10, 30, 10, 30, 30, 10, 30], 40, 40)!;
    const at = (x: number, y: number) => Array.from(out.rgba.slice(((y - out.y) * out.w + (x - out.x)) * 4, ((y - out.y) * out.w + (x - out.x)) * 4 + 3));
    expect(at(14, 14)).toEqual(colors[0]);
    expect(at(25, 14)).toEqual(colors[1]);
    expect(at(14, 25)).toEqual(colors[2]);
    expect(at(25, 25)).toEqual(colors[3]);
  });

  it("fits a pasted image inside the plane, centred, keeping its aspect", () => {
    const r = fitFloatRect([0, 0, 100, 0, 100, 50, 0, 50], 400, 100, 3);
    expect(r.plane).toBe(3);
    expect(r.u1 - r.u0).toBeCloseTo(1, 6);
    expect(r.v1 - r.v0).toBeCloseTo(0.5, 6); // 400×100 into 100×50 px → full width, half height
    expect((r.v0 + r.v1) / 2).toBeCloseTo(0.5, 6);
    expect(uvRectQuad([0, 0, 100, 0, 100, 50, 0, 50], r)).toEqual([0, 12.5, 100, 12.5, 100, 37.5, 0, 37.5]);
    expect(shiftRect(r, 5, -5)).toEqual({ plane: 3, u0: 0, v0: 0, u1: 1, v1: 0.5 });
  });
});
