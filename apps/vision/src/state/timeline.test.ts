import { describe, it, expect } from "vitest";
import { sampleTimeline, upsertKey, timelineLayerIds, type TimelineKey } from "./timeline";

const keys: TimelineKey[] = [
  { layerId: 1, t: 0, opacity: 0, dx: 0, dy: 0 },
  { layerId: 1, t: 2, opacity: 1, dx: 100, dy: -50 },
];

describe("timeline", () => {
  it("interpolates linearly between keyframes", () => {
    const s = sampleTimeline(keys, 1, 1)!;
    expect(s.opacity).toBeCloseTo(0.5);
    expect(s.dx).toBe(50);
    expect(s.dy).toBe(-25);
  });

  it("clamps outside the keyframe range", () => {
    expect(sampleTimeline(keys, 1, -1)!.opacity).toBe(0);
    expect(sampleTimeline(keys, 1, 99)!.dx).toBe(100);
  });

  it("returns null for a layer with no keys", () => {
    expect(sampleTimeline(keys, 2, 1)).toBeNull();
  });

  it("upsert replaces a same-time key and lists layer ids", () => {
    const k2 = upsertKey(keys, { layerId: 1, t: 0, opacity: 0.3, dx: 5, dy: 5 });
    expect(k2.filter((k) => k.t === 0)).toHaveLength(1);
    expect(sampleTimeline(k2, 1, 0)!.opacity).toBe(0.3);
    expect(timelineLayerIds(k2)).toEqual([1]);
  });
});
