// ─────────────────────────────────────────────────────────────
// transport.ts — pure playback-transport maths.
//
// Unity's Game view has a "Step" button that advances Play mode by exactly one
// frame. Jouer mirrors this on the timeline: stepping moves the playhead by one
// frame (1 / fps seconds) in either direction, clamped to the timeline's
// playable range.
//
// Nothing in this module imports React, Phaser, or the DOM.
// ─────────────────────────────────────────────────────────────

/** Advance (`dir` +1) or rewind (`dir` -1) the playhead by one frame, clamped to
 *  [0, extent]. `fps` below 1 is treated as 1 (a one-second frame) so the step
 *  is always well-defined. */
export function stepPlayhead(current: number, fps: number, dir: -1 | 1, extent: number): number {
  const frame = 1 / Math.max(1, fps);
  return Math.max(0, Math.min(extent, current + dir * frame));
}

// ── Keyframe navigation (Unity Animation-window |◄ / ►| buttons) ──────────────
// Jump the playhead to the next / previous keyframe in the clip. The finders take
// the clip's keyframe times (any order, duplicates allowed) and return the
// nearest time on the requested side of `current`, or null when there is none.
// The `eps` guard keeps a jump from sticking on the keyframe the playhead is
// already sitting on.

/** The smallest keyframe time strictly after `current`, or null if none. */
export function nextKeyframeTime(times: number[], current: number, eps = 1e-4): number | null {
  let best: number | null = null;
  for (const t of times) {
    if (t > current + eps && (best === null || t < best)) best = t;
  }
  return best;
}

/** The largest keyframe time strictly before `current`, or null if none. */
export function prevKeyframeTime(times: number[], current: number, eps = 1e-4): number | null {
  let best: number | null = null;
  for (const t of times) {
    if (t < current - eps && (best === null || t > best)) best = t;
  }
  return best;
}
