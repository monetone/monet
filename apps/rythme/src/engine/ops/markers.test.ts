// ─────────────────────────────────────────────────────────────
// ops/markers.test — Merge Markers (Adobe Audition parity)
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { emptyProject, newMarker } from "../model/factory";
import type { Project } from "../model/types";
import { mergeMarkersInRange, nextMarkerTime, prevMarkerTime } from "./markers";

const withMarkers = (times: number[]): Project => {
  const p = emptyProject("T", 1, 48000);
  return { ...p, markers: times.map((t) => newMarker({ time: t, name: `M${t}` })) };
};

describe("mergeMarkersInRange", () => {
  it("merges the in-range markers into one region spanning min..max, leaving others", () => {
    const out = mergeMarkersInRange(withMarkers([1, 2, 3, 10]), 0.5, 3.5); // captures 1,2,3 (not 10)
    expect(out.markers).toHaveLength(2);
    const region = out.markers.find((m) => m.kind === "region")!;
    expect(region.time).toBe(1);
    expect(region.end).toBe(3);
    expect(out.markers.some((m) => m.time === 10 && m.end == null)).toBe(true); // outside marker untouched
  });

  it("keeps the first in-range marker's name", () => {
    expect(mergeMarkersInRange(withMarkers([2, 4]), 0, 5).markers[0].name).toBe("M2");
  });

  it("uses region markers' ends when computing the span", () => {
    const p = emptyProject("T", 1, 48000);
    const out = mergeMarkersInRange({ ...p, markers: [newMarker({ time: 1, end: 2, name: "A" }), newMarker({ time: 3, name: "B" })] }, 0, 5);
    expect(out.markers).toHaveLength(1);
    expect(out.markers[0].time).toBe(1);
    expect(out.markers[0].end).toBe(3); // max(end 2, time 3)
  });

  it("is a no-op (same ref) with fewer than two markers in range", () => {
    const p = withMarkers([1, 10]);
    expect(mergeMarkersInRange(p, 0, 5)).toBe(p); // only marker 1 in range
    expect(mergeMarkersInRange(p, 20, 30)).toBe(p); // none in range
  });

  it("normalizes a reversed range (start > end)", () => {
    expect(mergeMarkersInRange(withMarkers([1, 2, 3]), 3.5, 0.5).markers).toHaveLength(1);
  });

  it("keeps the marker list sorted by time", () => {
    const out = mergeMarkersInRange(withMarkers([5, 6, 1]), 4, 7); // merges 5,6 → region; 1 stays
    expect(out.markers.map((m) => m.time)).toEqual([1, 5]);
  });
});

describe("nextMarkerTime / prevMarkerTime", () => {
  const markers = withMarkers([5, 1, 3]).markers; // unsorted on purpose

  it("nextMarkerTime returns the earliest marker strictly after the time", () => {
    expect(nextMarkerTime(markers, 0)).toBe(1);
    expect(nextMarkerTime(markers, 1)).toBe(3); // strictly after — not 1 itself
    expect(nextMarkerTime(markers, 3.5)).toBe(5);
    expect(nextMarkerTime(markers, 5)).toBeNull(); // none after the last
    expect(nextMarkerTime([], 0)).toBeNull();
  });

  it("prevMarkerTime returns the latest marker strictly before the time", () => {
    expect(prevMarkerTime(markers, 10)).toBe(5);
    expect(prevMarkerTime(markers, 3)).toBe(1); // strictly before — not 3 itself
    expect(prevMarkerTime(markers, 1)).toBeNull(); // none before the first
    expect(prevMarkerTime([], 5)).toBeNull();
  });
});
