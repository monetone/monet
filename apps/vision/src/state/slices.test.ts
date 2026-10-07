// Unit tests for the Slice / Slice Select geometry + stack logic. Engine-free
// (node); the tool wiring is covered by e2e/slice-tools.spec.ts.
import { describe, it, expect } from "vitest";
import {
  sliceFromDrag, addSlice, deleteSlice, hitTestSlice, moveSliceBy,
  sliceHandles, hitTestHandle, resizeSliceTo,
  clampSliceToDoc,
  sliceExportName,
} from "./slices";

describe("sliceFromDrag", () => {
  it("normalizes a forward drag", () => {
    expect(sliceFromDrag(10, 20, 110, 80)).toEqual({ x: 10, y: 20, w: 100, h: 60 });
  });
  it("normalizes a reversed drag (bottom-right → top-left)", () => {
    expect(sliceFromDrag(110, 80, 10, 20)).toEqual({ x: 10, y: 20, w: 100, h: 60 });
  });
  it("rounds fractional coordinates", () => {
    expect(sliceFromDrag(10.4, 20.6, 50.6, 60.4)).toEqual({ x: 10, y: 21, w: 40, h: 40 });
  });
});

describe("addSlice / deleteSlice", () => {
  it("appends immutably", () => {
    const a = [{ x: 0, y: 0, w: 10, h: 10 }];
    const b = addSlice(a, { x: 5, y: 5, w: 20, h: 20 });
    expect(b).toHaveLength(2);
    expect(b[1]).toEqual({ x: 5, y: 5, w: 20, h: 20 });
    expect(a).toHaveLength(1); // original untouched
  });
  it("deletes by index immutably", () => {
    const a = [{ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 20, h: 20 }];
    expect(deleteSlice(a, 0)).toEqual([{ x: 5, y: 5, w: 20, h: 20 }]);
    expect(a).toHaveLength(2);
  });
  it("ignores an out-of-range delete (returns the same array)", () => {
    const a = [{ x: 0, y: 0, w: 10, h: 10 }];
    expect(deleteSlice(a, 5)).toBe(a);
    expect(deleteSlice(a, -1)).toBe(a);
  });
});

describe("hitTestSlice", () => {
  const slices = [
    { x: 0, y: 0, w: 100, h: 100 },
    { x: 50, y: 50, w: 100, h: 100 }, // overlaps the first
  ];
  it("returns -1 when no slice contains the point", () => {
    expect(hitTestSlice(slices, 200, 200)).toBe(-1);
  });
  it("returns the only slice under the point", () => {
    expect(hitTestSlice(slices, 10, 10)).toBe(0);
  });
  it("returns the topmost (last) slice in an overlap", () => {
    expect(hitTestSlice(slices, 60, 60)).toBe(1);
  });
  it("includes the slice edges", () => {
    expect(hitTestSlice([{ x: 10, y: 10, w: 20, h: 20 }], 30, 30)).toBe(0);
  });
});

describe("moveSliceBy", () => {
  it("translates and rounds, keeping the size", () => {
    expect(moveSliceBy({ x: 10, y: 10, w: 40, h: 30 }, 5.4, -3.6)).toEqual({ x: 15, y: 6, w: 40, h: 30 });
  });
});

describe("sliceHandles / hitTestHandle", () => {
  const s = { x: 0, y: 0, w: 100, h: 80 };
  it("yields 8 handles clockwise from TL", () => {
    const h = sliceHandles(s);
    expect(h).toHaveLength(8);
    expect(h[0]).toEqual({ x: 0, y: 0 });    // TL
    expect(h[2]).toEqual({ x: 100, y: 0 });  // TR
    expect(h[4]).toEqual({ x: 100, y: 80 }); // BR
    expect(h[6]).toEqual({ x: 0, y: 80 });   // BL
  });
  it("hit-tests the handle within tolerance", () => {
    expect(hitTestHandle(s, 100, 80, 5)).toBe(4); // BR corner
    expect(hitTestHandle(s, 50, 0, 5)).toBe(1);   // top-mid
  });
  it("returns -1 when no handle is near (the body centre)", () => {
    expect(hitTestHandle(s, 50, 40, 5)).toBe(-1);
  });
});

describe("resizeSliceTo", () => {
  const s = { x: 10, y: 10, w: 100, h: 100 }; // right=110, bottom=110
  it("drags the BR corner (handle 4) to a new size", () => {
    expect(resizeSliceTo(s, 4, 160, 140)).toEqual({ x: 10, y: 10, w: 150, h: 130 });
  });
  it("drags the TL corner (handle 0), moving the origin", () => {
    expect(resizeSliceTo(s, 0, 30, 40)).toEqual({ x: 30, y: 40, w: 80, h: 70 });
  });
  it("drags an edge handle (R, handle 3) on one axis only", () => {
    expect(resizeSliceTo(s, 3, 200, 999)).toEqual({ x: 10, y: 10, w: 190, h: 100 });
  });
  it("flips cleanly and clamps to a min extent of 1 past the opposite edge", () => {
    const r = resizeSliceTo(s, 4, 10, 10); // drag BR onto TL
    expect(r.w).toBeGreaterThanOrEqual(1);
    expect(r.h).toBeGreaterThanOrEqual(1);
  });
});

describe("slice export helpers", () => {
  it("clamps slices to the document and drops empty remainders", () => {
    expect(clampSliceToDoc({ x: -5, y: -5, w: 20, h: 20 }, 10, 10)).toEqual({ x: 0, y: 0, w: 10, h: 10 });
    expect(clampSliceToDoc({ x: 4, y: 6, w: 4, h: 2 }, 10, 10)).toEqual({ x: 4, y: 6, w: 4, h: 2 });
    expect(clampSliceToDoc({ x: 12, y: 0, w: 4, h: 4 }, 10, 10)).toBeNull();
    expect(clampSliceToDoc({ x: 0, y: 0, w: 0, h: 5 }, 10, 10)).toBeNull();
  });

  it("names slice files the Photoshop way (1-based, zero-padded)", () => {
    expect(sliceExportName("hero", 0, "png")).toBe("hero_01.png");
    expect(sliceExportName("hero", 9, "jpeg")).toBe("hero_10.jpeg");
  });
});
