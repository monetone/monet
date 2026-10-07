import { describe, expect, it } from "vitest";

import { DEFAULT_HEAL_RADIUS, healEllipseRadii, hitHealSpot, placeHealSpot } from "./healSpots";

describe("placeHealSpot", () => {
  it("targets the click and offsets the source toward the image centre", () => {
    const left = placeHealSpot(0.2, 0.4);
    expect(left).toMatchObject({
      mode: "heal",
      x: 0.2,
      y: 0.4,
      sourceY: 0.4,
      radius: DEFAULT_HEAL_RADIUS,
      feather: 0.5,
      opacity: 1,
    });
    expect(left.sourceX).toBeCloseTo(0.2 + Math.max(DEFAULT_HEAL_RADIUS * 3, 0.06));
    // Right-half clicks push the source left; radius·3 wins once it beats 0.06.
    const right = placeHealSpot(0.9, 0.5, 0.05);
    expect(right.sourceX).toBeCloseTo(0.9 - 0.15);
  });

  it("clamps target and source into the frame", () => {
    const s = placeHealSpot(1.2, -0.3);
    expect(s.x).toBe(1);
    expect(s.y).toBe(0);
    expect(s.sourceX).toBeLessThanOrEqual(1);
    expect(s.sourceY).toBe(0);
  });
});

describe("hitHealSpot", () => {
  const spot = placeHealSpot(0.5, 0.5, 0.05); // source lands at 0.65

  it("hits target and source separately and misses far points", () => {
    expect(hitHealSpot([spot], 0.5, 0.5, 1)).toEqual({ index: 0, handle: "target" });
    expect(hitHealSpot([spot], spot.sourceX, 0.5, 1)).toEqual({ index: 0, handle: "source" });
    expect(hitHealSpot([spot], 0.9, 0.1, 1)).toBeNull();
  });

  it("scans the most recently placed spot first", () => {
    const twin = { ...spot };
    expect(hitHealSpot([spot, twin], 0.5, 0.5, 1)).toEqual({ index: 1, handle: "target" });
  });

  it("aspect-corrects the reach: a wide display shrinks x tolerance", () => {
    // dx 0.04 at radius 0.05: square hit (0.04 < 0.05), aspect-2 miss (0.08 > 0.05).
    expect(hitHealSpot([spot], 0.54, 0.5, 1)).toEqual({ index: 0, handle: "target" });
    expect(hitHealSpot([spot], 0.54, 0.5, 2)).toBeNull();
  });

  it("keeps tiny spots grabbable via the minimum hit size", () => {
    const tiny = { ...spot, radius: 0.001 };
    expect(hitHealSpot([tiny], 0.51, 0.5, 1)).toEqual({ index: 0, handle: "target" });
  });
});

describe("healEllipseRadii", () => {
  it("draws a screen circle on wide, tall, and square displays", () => {
    expect(healEllipseRadii(0.1, 2)).toEqual({ rx: 0.05, ry: 0.1 });
    expect(healEllipseRadii(0.1, 0.5)).toEqual({ rx: 0.1, ry: 0.05 });
    expect(healEllipseRadii(0.1, 1)).toEqual({ rx: 0.1, ry: 0.1 });
  });
});
