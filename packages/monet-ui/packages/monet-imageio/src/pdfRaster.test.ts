import { describe, it, expect } from "vitest";
import { PDF_RE, PDF_MAX_DIM, PDF_PIXEL_BUDGET, pdfRenderPlan } from "./pdfRaster";

describe("PDF_RE", () => {
  it("matches .pdf names case-insensitively, not others", () => {
    expect(PDF_RE.test("doc.pdf")).toBe(true);
    expect(PDF_RE.test("DOC.PDF")).toBe(true);
    expect(PDF_RE.test("a.b.pdf")).toBe(true);
    expect(PDF_RE.test("doc.png")).toBe(false);
    expect(PDF_RE.test("pdf.svg")).toBe(false);
    expect(PDF_RE.test("doc.pdfx")).toBe(false);
  });
});

describe("pdfRenderPlan", () => {
  it("renders a normal page at 2× (144 DPI) with floor-exact pixel dims", () => {
    expect(pdfRenderPlan(100, 60)).toEqual({ scale: 2, w: 200, h: 120 });
  });

  it("honours an explicit scale / maxDim override", () => {
    expect(pdfRenderPlan(100, 100, { scale: 1 })).toEqual({ scale: 1, w: 100, h: 100 });
    expect(pdfRenderPlan(1000, 1000, { maxDim: 100 })).toEqual({ scale: 0.1, w: 100, h: 100 });
  });

  it("clamps a large page down to the pixel budget", () => {
    const plan = pdfRenderPlan(4000, 4000);
    expect(plan.scale).toBeLessThan(2);
    expect(plan.w * plan.h).toBeLessThanOrEqual(PDF_PIXEL_BUDGET);
    expect(plan.w).toBe(4898);
    expect(plan.h).toBe(4898);
  });

  it("guards a huge MediaBox: neither axis exceeds PDF_MAX_DIM", () => {
    const wide = pdfRenderPlan(100000, 50);
    expect(wide.w).toBe(PDF_MAX_DIM); // capped, not 200000
    expect(wide.h).toBe(4);           // clamped to >= 1

    const big = pdfRenderPlan(50000, 50000);
    expect(big.w).toBeLessThanOrEqual(PDF_MAX_DIM);
    expect(big.h).toBeLessThanOrEqual(PDF_MAX_DIM);
    expect(big.w * big.h).toBeLessThanOrEqual(PDF_PIXEL_BUDGET);
  });

  it("never returns a non-positive or non-finite dimension for degenerate input", () => {
    for (const [w, h] of [[0, 0], [NaN, 100], [-5, -5], [Infinity, 10]] as [number, number][]) {
      const plan = pdfRenderPlan(w, h);
      expect(Number.isFinite(plan.w)).toBe(true);
      expect(Number.isFinite(plan.h)).toBe(true);
      expect(plan.w).toBeGreaterThanOrEqual(1);
      expect(plan.h).toBeGreaterThanOrEqual(1);
    }
  });
});
