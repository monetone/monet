// ─────────────────────────────────────────────────────────────
// timeline.ts — pure helpers for the keyframe Timeline (motion graphics).
// Engine-free so they unit-test in node; the Store drives the engine's
// non-destructive layer opacity + offset per frame when rendering.
// ─────────────────────────────────────────────────────────────

export interface TimelineKey {
  layerId: number;
  t: number; // seconds
  opacity: number; // 0..1
  dx: number; // non-destructive layer x offset (px)
  dy: number; // non-destructive layer y offset (px)
}

export interface TimelineState {
  fps: number;
  durationS: number;
  keys: TimelineKey[];
}

export const DEFAULT_TIMELINE: TimelineState = { fps: 12, durationS: 3, keys: [] };

/** Distinct layer ids with at least one keyframe, in first-seen order. */
export function timelineLayerIds(keys: TimelineKey[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const k of keys) if (!seen.has(k.layerId)) { seen.add(k.layerId); out.push(k.layerId); }
  return out;
}

/** Interpolated {opacity, dx, dy} for `layerId` at time `t` — linear between its
 *  keyframes, clamped to the first/last outside their range. Null if the layer
 *  has no keyframes. */
export function sampleTimeline(keys: TimelineKey[], layerId: number, t: number): { opacity: number; dx: number; dy: number } | null {
  const ks = keys.filter((k) => k.layerId === layerId).sort((a, b) => a.t - b.t);
  if (!ks.length) return null;
  if (t <= ks[0].t) return { opacity: ks[0].opacity, dx: ks[0].dx, dy: ks[0].dy };
  const last = ks[ks.length - 1];
  if (t >= last.t) return { opacity: last.opacity, dx: last.dx, dy: last.dy };
  for (let i = 0; i < ks.length - 1; i++) {
    const a = ks[i], b = ks[i + 1];
    if (t >= a.t && t <= b.t) {
      const f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
      return {
        opacity: a.opacity + (b.opacity - a.opacity) * f,
        dx: Math.round(a.dx + (b.dx - a.dx) * f),
        dy: Math.round(a.dy + (b.dy - a.dy) * f),
      };
    }
  }
  return { opacity: last.opacity, dx: last.dx, dy: last.dy };
}

/** Add or replace a keyframe (same layer + ~same time replaces). */
export function upsertKey(keys: TimelineKey[], key: TimelineKey): TimelineKey[] {
  const rest = keys.filter((k) => !(k.layerId === key.layerId && Math.abs(k.t - key.t) < 1e-4));
  return [...rest, key].sort((a, b) => a.t - b.t);
}
