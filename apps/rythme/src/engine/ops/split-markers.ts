// ─────────────────────────────────────────────────────────────
// engine/ops/split-markers — split clips at marker positions
// ─────────────────────────────────────────────────────────────
// Audition's "Split clips at markers": razor every clip that a marker falls
// inside, turning the markers Mark Audio / Mark Beats dropped into real clip
// boundaries. Region markers cut at BOTH their start and end. Built on splitAt
// (the razor), so a marker on a clip edge or outside any clip is a no-op.
// Immutable: a new Project is returned (the same reference when nothing splits).

import { splitAt } from "./clip";
import type { Project } from "../model/types";

/**
 * Split clips at every marker. `trackIds` limits the operation to those tracks
 * (default: all). Cut times are de-duplicated and applied in ascending order.
 */
export function splitClipsAtMarkers(project: Project, trackIds?: string[]): Project {
  const times: number[] = [];
  for (const m of project.markers) {
    times.push(m.time);
    if (m.end != null && m.end > m.time) times.push(m.end); // region marker → cut both edges
  }
  if (times.length === 0) return project;

  let next = project;
  for (const time of [...new Set(times)].sort((a, b) => a - b)) {
    next = splitAt(next, time, trackIds);
  }
  return next;
}
