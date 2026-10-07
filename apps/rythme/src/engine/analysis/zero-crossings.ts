// ─────────────────────────────────────────────────────────────
// engine/analysis/zero-crossings — snap times to zero crossings
// ─────────────────────────────────────────────────────────────
// Adobe Audition's Edit ▸ Zero Crossings nudges a selection's edges to the
// nearest point where the waveform crosses zero, so cuts and fades don't click.
// Pure index math over a mono signal; the UI renders the scope and feeds it in.

export type ZeroCrossMode = "inward" | "outward";

/** True when the waveform crosses zero between samples i-1 and i (a sign change,
 *  counting a sample that sits exactly on zero as a crossing). A flat run of
 *  silence is therefore "all crossings", so edges in silence stay where they are
 *  — which is fine: silence has no click to avoid. */
function isCrossing(mono: Float32Array, i: number): boolean {
  if (i <= 0 || i >= mono.length) return false;
  const a = mono[i - 1];
  const b = mono[i];
  if (b === 0) return true;
  return (a < 0 && b > 0) || (a > 0 && b < 0);
}

/**
 * Index of the nearest zero crossing to `from`, searching in `dir`
 * (+1 = later/right, -1 = earlier/left, 0 = nearest in either direction). The
 * search includes `from` itself, so an edge already on a crossing stays put.
 * Returns `from` (clamped into range) when no crossing exists that way.
 */
export function nearestZeroCrossing(mono: Float32Array, from: number, dir: -1 | 0 | 1): number {
  const n = mono.length;
  if (n < 2) return 0;
  const start = Math.max(0, Math.min(n - 1, Math.round(from)));
  if (dir > 0) {
    for (let i = Math.max(1, start); i < n; i++) if (isCrossing(mono, i)) return i;
    return start;
  }
  if (dir < 0) {
    for (let i = Math.min(n - 1, start); i >= 1; i--) if (isCrossing(mono, i)) return i;
    return start;
  }
  for (let off = 0; off < n; off++) {
    const l = start - off;
    const r = start + off;
    if (l >= 1 && isCrossing(mono, l)) return l; // ties resolve toward the earlier crossing
    if (r < n && isCrossing(mono, r)) return r;
  }
  return start;
}

/**
 * Move a time range's edges onto zero crossings of `mono`. "inward" pulls each
 * edge toward the selection centre (start→later, end→earlier); "outward" pushes
 * them apart. If an inward adjustment would collapse the range, the original is
 * returned unchanged. Edges snap to whole samples (no sub-sample interpolation) —
 * intentional, since every downstream edit re-quantizes the range to samples.
 */
export function adjustRangeToZeroCrossings(
  mono: Float32Array,
  sampleRate: number,
  range: { start: number; end: number },
  mode: ZeroCrossMode,
): { start: number; end: number } {
  if (mono.length < 2 || sampleRate <= 0) return range;
  const startIdx = Math.round(range.start * sampleRate);
  const endIdx = Math.round(range.end * sampleRate);
  const leftDir = mode === "inward" ? 1 : -1;
  const rightDir = mode === "inward" ? -1 : 1;
  const s = nearestZeroCrossing(mono, startIdx, leftDir);
  const e = nearestZeroCrossing(mono, endIdx, rightDir);
  if (e <= s) return range; // collapsed (no usable crossing between the edges) → leave as-is
  return { start: s / sampleRate, end: e / sampleRate };
}
