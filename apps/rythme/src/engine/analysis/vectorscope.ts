// ─────────────────────────────────────────────────────────────
// engine/analysis/vectorscope — Adobe Audition–style Phase Scope / Goniometer
// ─────────────────────────────────────────────────────────────
// Audition's Phase Analysis panel includes a vectorscope (goniometer / Lissajous
// scope): an X-Y plot of the left vs. right channel on an inclined L/R axis so
// the stereo image is read at a glance — a mono signal traces a vertical line, a
// polarity-inverted channel a horizontal line, and a wide stereo image fans out.
// We plot the mid/side rotation: x = side = (L−R)/√2, y = mid = (L+R)/√2. The
// samples are decimated to at most `maxPoints` and scaled to fit [−1, 1]. Pure
// measurement; never mutates the input.

import { frameCount, type AudioData } from "../audio/types";

export interface VectorscopeResult {
  /** Side axis (L−R)/√2 per point — horizontal on the scope. */
  x: Float32Array;
  /** Mid axis (L+R)/√2 per point — vertical on the scope. */
  y: Float32Array;
  /** Number of plotted points. */
  count: number;
}

export interface VectorscopeOptions {
  /** Maximum points to plot; the signal is decimated to fit. Default 2048. */
  maxPoints?: number;
  /** Scale so the largest coordinate reaches ±1. Default true. */
  normalize?: boolean;
}

const SQRT1_2 = Math.SQRT1_2;

/**
 * Build goniometer points for a stereo pair (mono is treated as L = R, a
 * centred vertical line). Returns decimated, optionally peak-normalized x/y.
 */
export function vectorscope(d: AudioData, opts: VectorscopeOptions = {}): VectorscopeResult {
  const n = frameCount(d);
  if (n === 0) return { x: new Float32Array(0), y: new Float32Array(0), count: 0 };

  const maxPoints = Math.max(1, Math.floor(opts.maxPoints ?? 2048));
  const stride = Math.max(1, Math.ceil(n / maxPoints));
  const count = Math.ceil(n / stride);
  const x = new Float32Array(count);
  const y = new Float32Array(count);
  const L = d.channels[0];
  const R = d.channels[1] ?? d.channels[0]; // mono → both axes from one channel

  let peak = 0;
  let j = 0;
  for (let i = 0; i < n; i += stride) {
    const xs = (L[i] - R[i]) * SQRT1_2;
    const ys = (L[i] + R[i]) * SQRT1_2;
    x[j] = xs;
    y[j] = ys;
    const a = Math.abs(xs);
    const b = Math.abs(ys);
    if (a > peak) peak = a;
    if (b > peak) peak = b;
    j++;
  }

  if ((opts.normalize ?? true) && peak > 0) {
    const inv = 1 / peak;
    for (let i = 0; i < count; i++) {
      x[i] *= inv;
      y[i] *= inv;
    }
  }
  return { x, y, count };
}
