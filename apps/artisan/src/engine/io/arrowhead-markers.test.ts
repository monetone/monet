// ─────────────────────────────────────────────────────────────
// io/arrowhead-markers.test — stroke arrowhead marker geometry
// ─────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { arrowheadGeom, hasArrowheads } from "./arrowhead-markers";

describe("arrowheadGeom", () => {
  it("returns geometry for each arrowhead kind", () => {
    for (const kind of ["triangle", "circle", "square", "bar"] as const) {
      const g = arrowheadGeom(kind);
      expect(g).toBeTruthy();
      expect(typeof g!.d).toBe("string");
      expect(g!.d.length).toBeGreaterThan(0);
      expect(g!.width).toBeGreaterThan(0);
      expect(g!.height).toBeGreaterThan(0);
    }
  });

  it("returns null for none / undefined", () => {
    expect(arrowheadGeom("none")).toBeNull();
    expect(arrowheadGeom(undefined)).toBeNull();
  });
});

describe("hasArrowheads", () => {
  it("is true iff a non-none arrow is set on either end", () => {
    expect(hasArrowheads(undefined, undefined)).toBe(false);
    expect(hasArrowheads("none", "none")).toBe(false);
    expect(hasArrowheads("triangle", undefined)).toBe(true);
    expect(hasArrowheads(undefined, "bar")).toBe(true);
    expect(hasArrowheads("none", "circle")).toBe(true);
  });
});
