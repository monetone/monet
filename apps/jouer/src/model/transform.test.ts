import { describe, expect, it } from "vitest";
import { resetTransformValues, pickTransformValues, applyTransformValues, constrainScale, ORIGIN_PRESETS, presetForOrigin } from "./transform";
import type { Transform } from "./types";

const t = (over: Partial<Transform> = {}): Transform => ({
  x: 100, y: 50, scaleX: 2, scaleY: 3, angle: 45, originX: 0.3, originY: 0.7, alpha: 0.5, ...over,
});

describe("resetTransformValues", () => {
  it("resets position, rotation and scale with target 'all' (preserving origin + alpha)", () => {
    expect(resetTransformValues(t(), "all")).toEqual({
      x: 0, y: 0, scaleX: 1, scaleY: 1, angle: 0, originX: 0.3, originY: 0.7, alpha: 0.5,
    });
  });

  it("resets position only", () => {
    const r = resetTransformValues(t(), "position");
    expect({ x: r.x, y: r.y }).toEqual({ x: 0, y: 0 });
    expect({ scaleX: r.scaleX, scaleY: r.scaleY, angle: r.angle }).toEqual({ scaleX: 2, scaleY: 3, angle: 45 });
  });

  it("resets rotation only", () => {
    const r = resetTransformValues(t(), "rotation");
    expect(r.angle).toBe(0);
    expect({ x: r.x, y: r.y, scaleX: r.scaleX, scaleY: r.scaleY }).toEqual({ x: 100, y: 50, scaleX: 2, scaleY: 3 });
  });

  it("resets scale only", () => {
    const r = resetTransformValues(t(), "scale");
    expect({ scaleX: r.scaleX, scaleY: r.scaleY }).toEqual({ scaleX: 1, scaleY: 1 });
    expect({ x: r.x, y: r.y, angle: r.angle }).toEqual({ x: 100, y: 50, angle: 45 });
  });

  it("defaults to 'all'", () => {
    expect(resetTransformValues(t())).toEqual(resetTransformValues(t(), "all"));
  });

  it("does not mutate its input", () => {
    const input = t();
    resetTransformValues(input, "all");
    expect(input).toEqual(t());
  });

  it("always preserves origin and alpha", () => {
    for (const target of ["all", "position", "rotation", "scale"] as const) {
      const r = resetTransformValues(t({ originX: 0.1, originY: 0.9, alpha: 0.25 }), target);
      expect({ originX: r.originX, originY: r.originY, alpha: r.alpha }).toEqual({ originX: 0.1, originY: 0.9, alpha: 0.25 });
    }
  });
});

describe("pickTransformValues", () => {
  it("snapshots only position, rotation and scale", () => {
    expect(pickTransformValues(t())).toEqual({ x: 100, y: 50, scaleX: 2, scaleY: 3, angle: 45 });
  });
});

describe("applyTransformValues", () => {
  it("replaces position/rotation/scale, preserving origin + alpha", () => {
    const target = t({ x: 0, y: 0, scaleX: 1, scaleY: 1, angle: 0, originX: 0.1, originY: 0.9, alpha: 0.25 });
    const out = applyTransformValues(target, { x: 100, y: 50, scaleX: 2, scaleY: 3, angle: 45 });
    expect(out).toEqual({ x: 100, y: 50, scaleX: 2, scaleY: 3, angle: 45, originX: 0.1, originY: 0.9, alpha: 0.25 });
  });

  it("round-trips through pick → apply", () => {
    const src = t();
    const dst = t({ x: -1, y: -1, scaleX: 9, scaleY: 9, angle: 180, originX: 0.2, alpha: 0.4 });
    const out = applyTransformValues(dst, pickTransformValues(src));
    expect({ x: out.x, y: out.y, scaleX: out.scaleX, scaleY: out.scaleY, angle: out.angle }).toEqual(pickTransformValues(src));
    expect({ originX: out.originX, alpha: out.alpha }).toEqual({ originX: 0.2, alpha: 0.4 }); // target's own
  });

  it("does not mutate its input", () => {
    const input = t({ x: 0, y: 0 });
    applyTransformValues(input, { x: 5, y: 5, scaleX: 1, scaleY: 1, angle: 0 });
    expect({ x: input.x, y: input.y }).toEqual({ x: 0, y: 0 });
  });
});

describe("pivot presets", () => {
  it("maps the nine presets to origin x/y with (0,0) = top-left", () => {
    expect(ORIGIN_PRESETS["top-left"]).toEqual({ x: 0, y: 0 });
    expect(ORIGIN_PRESETS.top).toEqual({ x: 0.5, y: 0 });
    expect(ORIGIN_PRESETS["top-right"]).toEqual({ x: 1, y: 0 });
    expect(ORIGIN_PRESETS.left).toEqual({ x: 0, y: 0.5 });
    expect(ORIGIN_PRESETS.center).toEqual({ x: 0.5, y: 0.5 });
    expect(ORIGIN_PRESETS.right).toEqual({ x: 1, y: 0.5 });
    expect(ORIGIN_PRESETS["bottom-left"]).toEqual({ x: 0, y: 1 });
    expect(ORIGIN_PRESETS.bottom).toEqual({ x: 0.5, y: 1 });
    expect(ORIGIN_PRESETS["bottom-right"]).toEqual({ x: 1, y: 1 });
  });

  it("presetForOrigin matches each preset's exact origin", () => {
    expect(presetForOrigin(0.5, 0.5)).toBe("center");
    expect(presetForOrigin(0, 0)).toBe("top-left");
    expect(presetForOrigin(1, 1)).toBe("bottom-right");
    expect(presetForOrigin(0, 0.5)).toBe("left");
  });

  it("presetForOrigin returns null for a custom origin", () => {
    expect(presetForOrigin(0.3, 0.7)).toBeNull();
    expect(presetForOrigin(0.25, 0.25)).toBeNull();
  });

  it("presetForOrigin tolerates tiny float error within eps", () => {
    expect(presetForOrigin(0.5000001, 0.4999999)).toBe("center");
  });

  it("presetForOrigin distinguishes a near-corner match from a custom origin", () => {
    expect(presetForOrigin(1, 0)).toBe("top-right");
    expect(presetForOrigin(0.99, 0.01)).toBeNull(); // outside eps → custom, not snapped
  });
});

// Unity "Constrain Proportions": a single-axis scale edit keeps the aspect ratio.
describe("constrainScale", () => {
  it("scales the other axis by the same ratio (from 1,1)", () => {
    expect(constrainScale(t({ scaleX: 1, scaleY: 1 }), { scaleX: 2 })).toEqual({ scaleX: 2, scaleY: 2 });
    expect(constrainScale(t({ scaleX: 1, scaleY: 1 }), { scaleY: 3 })).toEqual({ scaleY: 3, scaleX: 3 });
  });

  it("preserves a non-1 starting ratio", () => {
    // from (1, 2): scaling X to 2 (ratio 2) → Y becomes 4.
    expect(constrainScale(t({ scaleX: 1, scaleY: 2 }), { scaleX: 2 })).toEqual({ scaleX: 2, scaleY: 4 });
  });

  it("handles a negative target (ratio can be negative)", () => {
    expect(constrainScale(t({ scaleX: 1, scaleY: 1 }), { scaleX: -1 })).toEqual({ scaleX: -1, scaleY: -1 });
  });

  it("only sets the edited axis when the old axis is 0 (ratio undefined)", () => {
    expect(constrainScale(t({ scaleX: 0, scaleY: 1 }), { scaleX: 2 })).toEqual({ scaleX: 2 });
  });

  it("returns a two-axis or empty patch unchanged", () => {
    expect(constrainScale(t(), { scaleX: 2, scaleY: 5 })).toEqual({ scaleX: 2, scaleY: 5 });
    expect(constrainScale(t(), {})).toEqual({});
  });
});
