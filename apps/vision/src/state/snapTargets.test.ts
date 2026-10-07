// Unit tests for the snap-target helpers. Engine-free (node); the snapToGuides
// integration + the Snap To menu wiring are covered by e2e/snap-targets.spec.ts.
import { describe, it, expect } from "vitest";
import { axisSnapTargets, snapValue, type SnapTargets } from "./snapTargets";

const ALL: SnapTargets = { guides: true, grid: true, docBounds: true };

describe("axisSnapTargets", () => {
  it("includes bounds, guides and grid multiples when all targets are on", () => {
    const c = axisSnapTargets(100, [50], { on: true, spacing: 25 }, ALL);
    expect(c).toContain(0);
    expect(c).toContain(100);
    expect(c).toContain(50); // the guide
    expect(c).toEqual(expect.arrayContaining([0, 25, 50, 75, 100])); // grid multiples
  });

  it("drops the document bounds when docBounds is off", () => {
    const c = axisSnapTargets(100, [], { on: false, spacing: 25 }, { ...ALL, docBounds: false });
    expect(c).not.toContain(0);
    expect(c).not.toContain(100);
    expect(c).toEqual([]);
  });

  it("drops guide positions when guides is off", () => {
    const c = axisSnapTargets(100, [50], { on: false, spacing: 25 }, { ...ALL, guides: false, grid: false });
    expect(c).toEqual([0, 100]);
  });

  it("drops grid multiples when grid is off or the grid is inactive", () => {
    expect(axisSnapTargets(100, [], { on: true, spacing: 25 }, { ...ALL, grid: false })).toEqual([0, 100]);
    expect(axisSnapTargets(100, [], { on: false, spacing: 25 }, ALL)).toEqual([0, 100]);
  });

  it("clamps the grid spacing to a minimum of 2", () => {
    const c = axisSnapTargets(6, [], { on: true, spacing: 0 }, { guides: false, grid: true, docBounds: false });
    expect(c).toEqual([0, 2, 4, 6]);
  });
});

describe("snapValue", () => {
  it("snaps to a candidate within the threshold", () => {
    expect(snapValue(53, [0, 50, 100], 6)).toBe(50);
    expect(snapValue(3, [0, 100], 6)).toBe(0);
  });

  it("picks the NEAREST candidate, not the first one in the list", () => {
    // The candidate list is built bounds → guides → grid, so first-match meant
    // a document edge or grid line 5px away beat a guide 1px away: you place a
    // guide precisely and the marquee snaps to the canvas edge instead.
    expect(snapValue(5, [0, 6], 6)).toBe(6);
    // Same shape with the near candidate last, so a "return the last match"
    // implementation cannot pass this pair either.
    expect(snapValue(5, [4, 10], 6)).toBe(4);
  });

  it("leaves the value unchanged when no candidate is within the threshold", () => {
    expect(snapValue(53, [0, 100], 6)).toBe(53);
    expect(snapValue(5, [], 6)).toBe(5);
  });

  it("breaks an exact tie by list order, so the higher-priority target wins", () => {
    // 48 and 52 are both 2 away from 50; bounds/guides come before grid in the
    // candidate list, and a tie must not reshuffle that.
    expect(snapValue(50, [48, 52], 6)).toBe(48);
  });
});
