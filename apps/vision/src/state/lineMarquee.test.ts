// Unit tests for the Single Row / Single Column Marquee geometry. Engine-free
// (node); the click-to-select behaviour is covered by e2e/line-marquee.spec.ts.
import { describe, it, expect } from "vitest";
import { singleRowRect, singleColumnRect } from "./lineMarquee";

describe("singleRowRect", () => {
  it("spans the full width as a 1px row at the clicked y", () => {
    expect(singleRowRect(50, 200, 160)).toEqual({ x: 0, y: 50, w: 200, h: 1 });
  });
  it("rounds and clamps y to the canvas", () => {
    expect(singleRowRect(50.7, 200, 160)).toEqual({ x: 0, y: 51, w: 200, h: 1 });
    expect(singleRowRect(-5, 200, 160).y).toBe(0);
    expect(singleRowRect(999, 200, 160).y).toBe(159); // docH - 1
  });
});

describe("singleColumnRect", () => {
  it("spans the full height as a 1px column at the clicked x", () => {
    expect(singleColumnRect(70, 200, 160)).toEqual({ x: 70, y: 0, w: 1, h: 160 });
  });
  it("rounds and clamps x to the canvas", () => {
    expect(singleColumnRect(70.4, 200, 160)).toEqual({ x: 70, y: 0, w: 1, h: 160 });
    expect(singleColumnRect(-5, 200, 160).x).toBe(0);
    expect(singleColumnRect(999, 200, 160).x).toBe(199); // docW - 1
  });
});
