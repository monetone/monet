// ─────────────────────────────────────────────────────────────
// engine/ops/markers — marker edits over the project
// ─────────────────────────────────────────────────────────────
// Pure (project, …) => project transforms over the marker list.

import type { Marker, Project } from "../model/types";

/** Earliest marker time strictly after `after`, or null when there is none. */
export function nextMarkerTime(markers: Marker[], after: number): number | null {
  let best: number | null = null;
  for (const m of markers) if (m.time > after && (best === null || m.time < best)) best = m.time;
  return best;
}

/** Latest marker time strictly before `before`, or null when there is none. */
export function prevMarkerTime(markers: Marker[], before: number): number | null {
  let best: number | null = null;
  for (const m of markers) if (m.time < before && (best === null || m.time > best)) best = m.time;
  return best;
}

/** Markers whose start `time` falls within [start, end] (range normalized). */
export function markersInTimeRange(markers: Marker[], start: number, end: number): Marker[] {
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  return markers.filter((m) => m.time >= lo && m.time <= hi);
}

/**
 * Merge the markers whose `time` falls within [start, end] into a single region
 * marker (Audition's Merge Markers). The merged marker spans from the earliest
 * marker's time to the latest marker's end (or time), keeping the first marker's
 * name/color/kind. Fewer than two markers in range → the same project ref.
 * Note: a region marker that starts in range but whose end extends past it is
 * fully merged — its tail pulls the merged span's end beyond the selection.
 */
export function mergeMarkersInRange(project: Project, start: number, end: number): Project {
  const inRange = markersInTimeRange(project.markers, start, end);
  if (inRange.length < 2) return project;

  const spanStart = Math.min(...inRange.map((m) => m.time));
  const spanEnd = Math.max(...inRange.map((m) => m.end ?? m.time));
  const isRegion = spanEnd > spanStart;
  const merged: Marker = { ...inRange[0], time: spanStart, end: isRegion ? spanEnd : undefined, kind: isRegion ? "region" : "cue" };

  const removed = new Set(inRange.map((m) => m.id));
  const kept = project.markers.filter((m) => !removed.has(m.id));
  return { ...project, markers: [...kept, merged].sort((a, b) => a.time - b.time) };
}
