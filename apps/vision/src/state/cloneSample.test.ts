// Unit test for the Clone/Heal Sample options. Engine-free (node); the engine
// sampling behavior + dropdown wiring are covered by a Rust test + e2e.
import { describe, it, expect } from "vitest";
import {
  CLONE_SAMPLE_MODES, CLONE_SLOT_COUNT, DEFAULT_CLONE_TRANSFORM, cloneOverlayMatrix, defaultCloneSlots,
  isIdentityCloneTransform, validateCloneOptions,
} from "./cloneSample";

describe("CLONE_SAMPLE_MODES", () => {
  it("offers the three Photoshop sample sources in order", () => {
    expect(CLONE_SAMPLE_MODES.map((m) => m.value)).toEqual([0, 1, 2]);
    expect(CLONE_SAMPLE_MODES.map((m) => m.label)).toEqual(["Current Layer", "Current & Below", "All Layers"]);
  });
});

// Window ▸ Clone Source (#427).
describe("Clone Source slots", () => {
  it("start as five empty slots with independent identity transforms", () => {
    const slots = defaultCloneSlots();
    expect(CLONE_SLOT_COUNT).toBe(5);
    expect(slots).toHaveLength(5);
    expect(slots.every((s) => s.source === null && isIdentityCloneTransform(s.transform))).toBe(true);
    slots[0].transform.w = 50;
    expect(slots[1].transform.w).toBe(100);
    expect(DEFAULT_CLONE_TRANSFORM.w).toBe(100);
  });

  it("says which field is out of range and what range it takes", () => {
    expect(validateCloneOptions({ w: 1, h: 1000, angle: -180, opacity: 0 })).toBeNull();
    expect(validateCloneOptions({ flipH: true })).toBeNull();
    expect(validateCloneOptions({ w: 0 })).toBe("Width must be a number from 1% to 1000%.");
    expect(validateCloneOptions({ h: 1001 })).toBe("Height must be a number from 1% to 1000%.");
    expect(validateCloneOptions({ angle: 181 })).toBe("Angle must be a number from -180° to 180°.");
    expect(validateCloneOptions({ opacity: -1 })).toBe("Overlay opacity must be a number from 0% to 100%.");
    expect(validateCloneOptions({ w: Number("12%") }), "a field's unparsable text arrives as NaN").toMatch(/^Width/);
    expect(validateCloneOptions({ opacity: undefined })).toBeNull();
  });

  it("treats any scale, angle or flip as a transform", () => {
    for (const patch of [{ w: 99 }, { h: 200 }, { angle: 1 }, { flipH: true }, { flipV: true }]) {
      expect(isIdentityCloneTransform({ ...DEFAULT_CLONE_TRANSFORM, ...patch }), JSON.stringify(patch)).toBe(false);
    }
  });
});

describe("cloneOverlayMatrix", () => {
  // The engine samples dest d from s = S + M·(d − D); the overlay must draw
  // source pixel s at the d that samples it, i.e. d = D + M⁻¹·(s − S).
  const S = { x: 10, y: 20 };
  const D = { x: 50, y: 60 };
  const apply = ([a, b, c, d, e, f]: number[], p: { x: number; y: number }) => ({ x: a * p.x + c * p.y + e, y: b * p.x + d * p.y + f });
  const near = (p: { x: number; y: number }, x: number, y: number) => {
    expect(p.x).toBeCloseTo(x, 9);
    expect(p.y).toBeCloseTo(y, 9);
  };

  it("lands the source point on the anchor for every transform", () => {
    for (const t of [DEFAULT_CLONE_TRANSFORM, { w: 250, h: 40, angle: 33, flipH: true, flipV: true }]) {
      near(apply(cloneOverlayMatrix(S, D, t), S), D.x, D.y);
    }
  });

  it("mirrors, scales and turns the source the way the engine samples it", () => {
    const one = { x: S.x + 1, y: S.y }; // one source pixel to the right
    near(apply(cloneOverlayMatrix(S, D, DEFAULT_CLONE_TRANSFORM), one), D.x + 1, D.y);
    near(apply(cloneOverlayMatrix(S, D, { ...DEFAULT_CLONE_TRANSFORM, flipH: true }), one), D.x - 1, D.y);
    near(apply(cloneOverlayMatrix(S, D, { ...DEFAULT_CLONE_TRANSFORM, w: 200 }), one), D.x + 2, D.y);
    // 90°: the source's +x runs down the destination (the Rust test's (30,12) ← (12,9)).
    near(apply(cloneOverlayMatrix(S, D, { ...DEFAULT_CLONE_TRANSFORM, angle: 90 }), one), D.x, D.y + 1);
    near(apply(cloneOverlayMatrix(S, D, { ...DEFAULT_CLONE_TRANSFORM, flipV: true }), { x: S.x, y: S.y + 1 }), D.x, D.y - 1);
  });
});
