import { describe, expect, it } from "vitest";
import { nextKeyframeTime, prevKeyframeTime, stepPlayhead } from "./transport";

describe("stepPlayhead", () => {
  it("advances by one frame (1/fps)", () => {
    expect(stepPlayhead(0, 8, 1, 2)).toBe(0.125); // 1/8
    expect(stepPlayhead(0.125, 8, 1, 2)).toBe(0.25);
  });

  it("rewinds by one frame", () => {
    expect(stepPlayhead(0.5, 8, -1, 2)).toBe(0.375);
  });

  it("clamps at 0 when stepping back from the start", () => {
    expect(stepPlayhead(0, 8, -1, 2)).toBe(0);
  });

  it("clamps at the extent when stepping forward past the end", () => {
    expect(stepPlayhead(2, 8, 1, 2)).toBe(2);
    expect(stepPlayhead(1.95, 8, 1, 2)).toBe(2); // 1.95 + 0.125 > 2 → clamp
  });

  it("treats fps below 1 as a one-second frame", () => {
    expect(stepPlayhead(0, 0, 1, 10)).toBe(1);
    expect(stepPlayhead(0, 0.5, 1, 10)).toBe(1);
  });
});

// Unity-parity Animation keyframe navigation: find the nearest keyframe time on
// either side of the playhead (clip-level), tolerant of unsorted/duplicate input.
describe("nextKeyframeTime", () => {
  it("returns null for an empty clip", () => {
    expect(nextKeyframeTime([], 0)).toBeNull();
  });

  it("finds the next keyframe after the current time", () => {
    expect(nextKeyframeTime([0, 0.5, 1], 0)).toBe(0.5);
    expect(nextKeyframeTime([0, 0.5, 1], 0.5)).toBe(1);
  });

  it("returns null past the last keyframe", () => {
    expect(nextKeyframeTime([0, 0.5, 1], 1)).toBeNull();
    expect(nextKeyframeTime([0, 0.5, 1], 2)).toBeNull();
  });

  it("steps past a keyframe the playhead is sitting on (eps guard)", () => {
    expect(nextKeyframeTime([0, 1, 2], 1.00001)).toBe(2);
  });

  it("tolerates unsorted input and duplicate times", () => {
    expect(nextKeyframeTime([2, 0.5, 2, 1, 0.5], 0.5)).toBe(1);
  });

  it("collapses sub-eps-coincident times (e.g. cross-track) so navigation never sticks", () => {
    // two tracks keyed ~0.05ms apart: landing on either is indistinguishable
    expect(nextKeyframeTime([1, 1.00005], 0.5)).toBe(1);     // earliest of the pair
    expect(nextKeyframeTime([1, 1.00005], 1)).toBeNull();    // the other is within eps → no stick
  });
});

describe("prevKeyframeTime", () => {
  it("returns null for an empty clip", () => {
    expect(prevKeyframeTime([], 1)).toBeNull();
  });

  it("finds the previous keyframe before the current time", () => {
    expect(prevKeyframeTime([0, 0.5, 1], 1)).toBe(0.5);
    expect(prevKeyframeTime([0, 0.5, 1], 0.5)).toBe(0);
  });

  it("returns null before the first keyframe", () => {
    expect(prevKeyframeTime([0, 0.5, 1], 0)).toBeNull();
  });

  it("tolerates unsorted input and duplicate times", () => {
    expect(prevKeyframeTime([2, 0.5, 1, 1, 2], 2)).toBe(1);
  });
});
