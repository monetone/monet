import { describe, expect, it } from "vitest";
import { flipTransforms, type FlipItem } from "./flip";

const item = (x: number, y: number, scaleX = 1, scaleY = 1): FlipItem => ({ x, y, scaleX, scaleY });

describe("flipTransforms", () => {
  it("flips a single object in place (negates scaleX, leaves position)", () => {
    expect(flipTransforms([item(100, 50, 2, 3)], "horizontal")).toEqual([{ x: 100, y: 50, scaleX: -2, scaleY: 3 }]);
  });

  it("flips a single object vertically (negates scaleY, leaves position)", () => {
    expect(flipTransforms([item(100, 50, 2, 3)], "vertical")).toEqual([{ x: 100, y: 50, scaleX: 2, scaleY: -3 }]);
  });

  it("mirrors a group's positions across its centre and negates scaleX (horizontal)", () => {
    // x spans 100..300 → centre 200
    const out = flipTransforms([item(100, 0), item(300, 0)], "horizontal");
    expect(out[0]).toMatchObject({ x: 300, scaleX: -1 });
    expect(out[1]).toMatchObject({ x: 100, scaleX: -1 });
  });

  it("mirrors a group vertically across its centre", () => {
    // y spans 40..160 → centre 100
    const out = flipTransforms([item(0, 40), item(0, 160)], "vertical");
    expect(out[0]).toMatchObject({ y: 160, scaleY: -1 });
    expect(out[1]).toMatchObject({ y: 40, scaleY: -1 });
  });

  it("is an involution — flipping twice restores the original", () => {
    const orig = [item(120, 30, 1, 1), item(260, 90, 1.5, 2)];
    const once = flipTransforms(orig, "horizontal");
    const twice = flipTransforms(once, "horizontal");
    expect(twice).toEqual(orig);
  });

  it("preserves unrelated fields and the perpendicular axis", () => {
    const out = flipTransforms([{ x: 10, y: 20, scaleX: 1, scaleY: 4, id: "a" } as FlipItem & { id: string }], "horizontal");
    expect(out[0]).toEqual({ x: 10, y: 20, scaleX: -1, scaleY: 4, id: "a" });
  });

  it("returns an empty array for no items", () => {
    expect(flipTransforms([], "horizontal")).toEqual([]);
  });
});
