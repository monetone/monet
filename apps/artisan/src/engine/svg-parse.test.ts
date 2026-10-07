import { describe, it, expect } from "vitest";
import { IO, Mat } from "./index";

const approx = (a: number, b: number, eps = 1e-3) => Math.abs(a - b) <= eps;

describe("parseSvgPathD", () => {
  it("parses a closed polygon (H/V) into one subpath", () => {
    const sp = IO.parseSvgPathD("M0 0 H10 V10 H0 Z");
    expect(sp.length).toBe(1);
    expect(sp[0].closed).toBe(true);
    expect(sp[0].anchors.length).toBe(4);
    expect(sp[0].anchors[0].point).toEqual({ x: 0, y: 0 });
    expect(sp[0].anchors[2].point).toEqual({ x: 10, y: 10 });
  });

  it("converts an absolute cubic into relative handles", () => {
    const sp = IO.parseSvgPathD("M0 0 C0 5 5 10 10 10");
    const [a0, a1] = sp[0].anchors;
    expect(a0.handleOut).toEqual({ x: 0, y: 5 });
    expect(a1.point).toEqual({ x: 10, y: 10 });
    expect(a1.handleIn).toEqual({ x: -5, y: 0 });
  });

  it("handles relative commands + implicit lineto repeats", () => {
    const sp = IO.parseSvgPathD("m0 0 l10 0 10 10");
    expect(sp[0].anchors.map((a) => a.point)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 10 },
    ]);
  });

  it("splits multiple subpaths on M", () => {
    const sp = IO.parseSvgPathD("M0 0 L1 0 M5 5 L6 5");
    expect(sp.length).toBe(2);
  });

  it("converts a quadratic to a cubic", () => {
    const sp = IO.parseSvgPathD("M0 0 Q5 10 10 0");
    const [a0, a1] = sp[0].anchors;
    expect(approx(a0.handleOut.x, 10 / 3) && approx(a0.handleOut.y, 20 / 3)).toBe(true);
    expect(a1.point).toEqual({ x: 10, y: 0 });
    expect(approx(a1.handleIn.x, -10 / 3) && approx(a1.handleIn.y, 20 / 3)).toBe(true);
  });

  it("converts an elliptical arc to bezier segments ending at the endpoint", () => {
    const sp = IO.parseSvgPathD("M0 0 A5 5 0 0 1 10 0");
    expect(sp[0].anchors.length).toBeGreaterThanOrEqual(2);
    const last = sp[0].anchors[sp[0].anchors.length - 1].point;
    expect(approx(last.x, 10, 0.01) && approx(last.y, 0, 0.01)).toBe(true);
  });

  it("merges the closing anchor when it coincides with the start", () => {
    const sp = IO.parseSvgPathD("M0 0 L10 0 L10 10 L0 0 Z");
    expect(sp[0].closed).toBe(true);
    expect(sp[0].anchors.length).toBe(3); // duplicate start dropped
  });
});

describe("parseTransform", () => {
  it("parses translate", () => {
    const m = IO.parseTransform("translate(10,5)");
    expect(Mat.applyToPoint(m, { x: 0, y: 0 })).toEqual({ x: 10, y: 5 });
  });
  it("parses scale (single + dual)", () => {
    expect(IO.parseTransform("scale(2)").a).toBe(2);
    expect(IO.parseTransform("scale(2 3)").d).toBe(3);
  });
  it("parses rotate", () => {
    const p = Mat.applyToPoint(IO.parseTransform("rotate(90)"), { x: 1, y: 0 });
    expect(approx(p.x, 0) && approx(p.y, 1)).toBe(true);
  });
  it("parses rotate about a center", () => {
    const p = Mat.applyToPoint(IO.parseTransform("rotate(90 5 5)"), { x: 5, y: 0 });
    expect(approx(p.x, 10) && approx(p.y, 5)).toBe(true);
  });
  it("parses matrix and composes a transform list", () => {
    const m = IO.parseTransform("matrix(1,0,0,1,2,3)");
    expect(m).toEqual({ a: 1, b: 0, c: 0, d: 1, e: 2, f: 3 });
    const c = IO.parseTransform("translate(10 0) scale(2)");
    expect(Mat.applyToPoint(c, { x: 1, y: 0 })).toEqual({ x: 12, y: 0 });
  });
});
