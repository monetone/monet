import { describe, it, expect } from "vitest";
import { smartSnap } from "./smartGuides";

describe("smartSnap", () => {
  it("snaps a near-aligned left edge and records a vertical guide", () => {
    // same-size rects so left/centre/right all agree on dx = -3
    const r = smartSnap({ x: 103, y: 50, w: 20, h: 20 }, [{ x: 100, y: 200, w: 20, h: 20 }], 6);
    expect(r.dx).toBe(-3);
    expect(r.dy).toBe(0);
    expect(r.guides.some((g) => g.o === "v" && Math.abs(g.p - 100) < 0.5)).toBe(true);
  });
  it("does not snap beyond the threshold", () => {
    const r = smartSnap({ x: 120, y: 50, w: 20, h: 20 }, [{ x: 100, y: 200, w: 20, h: 20 }], 6);
    expect(r.dx).toBe(0);
  });
  it("prefers the closest alignment (centre over edge)", () => {
    // moving centre x=113, other centre 115 (d=2) beats left-left 100-103=-3
    const r = smartSnap({ x: 103, y: 0, w: 20, h: 20 }, [{ x: 100, y: 0, w: 30, h: 30 }], 6);
    expect(r.dx).toBe(2);
  });
  it("snaps both axes independently", () => {
    const r = smartSnap({ x: 102, y: 198, w: 10, h: 10 }, [{ x: 100, y: 200, w: 10, h: 10 }], 6);
    expect(r.dx).toBe(-2);
    expect(r.dy).toBe(2);
  });
});
