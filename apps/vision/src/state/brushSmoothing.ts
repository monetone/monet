// Brush "Smoothing" (Photoshop): the brush follows the cursor with a lag
// proportional to the Smoothing %, so jittery/shaky input renders as a clean
// curve. We smooth the input path — each drawn point eases from the previous
// drawn point toward the raw cursor by `1 - smoothing*0.9`. At smoothing 0 the
// drawn point IS the cursor (no change — strokes are byte-identical to before);
// higher smoothing lags more but always progresses, so the brush still tracks
// the cursor and catches up when it pauses. Pure + engine-free (node-testable).

export interface Pt {
  x: number;
  y: number;
}

/** Clamp the Smoothing amount into 0..1 (NaN → 0; ±Infinity clamp to the bounds). */
export function clampSmoothing(v: number): number {
  if (Number.isNaN(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

/** Ease the drawn point from `prev` toward the raw cursor `target` by the
 *  Smoothing-derived factor. smoothing 0 → returns `target` exactly. */
export function smoothStrokePoint(prev: Pt, target: Pt, smoothing: number): Pt {
  const f = 1 - clampSmoothing(smoothing) * 0.9; // 1 (no smoothing) … 0.1 (heavy lag)
  return { x: prev.x + (target.x - prev.x) * f, y: prev.y + (target.y - prev.y) * f };
}
