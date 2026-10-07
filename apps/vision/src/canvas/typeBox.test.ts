import { describe, it, expect } from "vitest";
import { typeBoxFromDrag, isOverset, TYPE_BOX_CURSORS, TYPE_DRAG_SLOP } from "./typeBox";
import { resizeSliceTo, sliceHandles } from "../state/slices";

describe("typeBoxFromDrag", () => {
  it("treats a within-slop drag as a click (point text)", () => {
    expect(typeBoxFromDrag(10, 10, 12, 11, 1)).toBeNull();
  });
  it("creates a normalized box past the slop, from any drag direction", () => {
    expect(typeBoxFromDrag(110, 90, 10, 20, 1)).toEqual({ x: 10, y: 20, w: 100, h: 70 });
  });
  it("measures the slop in screen px so zoom does not change the feel", () => {
    // 2 doc px at 4× zoom = 8 screen px → a real drag; at 1× it is a click.
    expect(typeBoxFromDrag(10, 10, 12, 12, 4)).not.toBeNull();
    expect(typeBoxFromDrag(10, 10, 12, 12, 1)).toBeNull();
  });
  it("a one-axis drag past the slop still makes a box (min extent 1)", () => {
    const b = typeBoxFromDrag(10, 10, 10 + TYPE_DRAG_SLOP + 1, 10, 1);
    expect(b).toEqual({ x: 10, y: 10, w: TYPE_DRAG_SLOP + 1, h: 1 });
  });
});

describe("isOverset", () => {
  it("flags a fixed-height paragraph box that clips its content", () => {
    expect(isOverset("paragraph", 100, 150)).toBe(true);
  });
  it("stays quiet for auto height, fitting content, and point text", () => {
    expect(isOverset("paragraph", 0, 150)).toBe(false);   // auto height never clips
    expect(isOverset("paragraph", 100, 100.5)).toBe(false); // sub-px rounding tolerance
    expect(isOverset("point", 100, 150)).toBe(false);
  });
});

describe("box handle geometry (shared slice math)", () => {
  it("has one cursor per handle, mirrored on the opposite corner/edge", () => {
    expect(TYPE_BOX_CURSORS).toHaveLength(sliceHandles({ x: 0, y: 0, w: 10, h: 10 }).length);
    for (let i = 0; i < 4; i++) expect(TYPE_BOX_CURSORS[i]).toBe(TYPE_BOX_CURSORS[i + 4]);
  });
  it("dragging the BR handle (4) reflows the box; TL (0) moves the anchor too", () => {
    const box = { x: 10, y: 20, w: 100, h: 50 };
    expect(resizeSliceTo(box, 4, 200, 120)).toEqual({ x: 10, y: 20, w: 190, h: 100 });
    expect(resizeSliceTo(box, 0, 0, 0)).toEqual({ x: 0, y: 0, w: 110, h: 70 });
  });
});
