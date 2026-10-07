// ─────────────────────────────────────────────────────────────
// engine/dsp/gain-envelope — Adobe Audition–style Fade / Gain Envelope
// ─────────────────────────────────────────────────────────────
// Audition's Amplitude ▸ Fade Envelope / Gain Envelope: draw an amplitude
// envelope over time with keyframe control points and the signal's level follows
// it — a custom fade in/out, a duck in the middle, a swell, a tremolo shape, etc.
// Each point is a {time, gain} pair (time as a 0…1 fraction of the selection,
// gain as a linear multiplier where 1 = unity, 0 = silence, >1 = boost). Points
// connect with straight lines ("linear") or a smooth curve ("spline", a
// Catmull-Rom through the points). Unlike the fixed Fade In/Out tools this is an
// arbitrary multi-point envelope. Pure `(AudioData, opts) => AudioData`; the
// input is never mutated.

import { cloneAudioData } from "../audio/buffer";
import { frameCount, type AudioData } from "../audio/types";

/** One keyframe: a linear gain at a 0…1 time fraction of the selection. */
export interface GainEnvelopePoint {
  /** Position as a fraction of the buffer, 0 = start … 1 = end. */
  time: number;
  /** Linear gain multiplier (1 = unity, 0 = silence, >1 = boost). */
  gain: number;
}

export interface GainEnvelopeOptions {
  /** Envelope keyframes (any order). Fewer than two points = a flat passthrough. */
  points?: GainEnvelopePoint[];
  /** "linear" straight segments (default) or "spline" smooth Catmull-Rom curve. */
  interpolation?: "linear" | "spline";
}

/** Catmull-Rom interpolation between p1 and p2 (p0/p3 are the neighbours). */
function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/**
 * Envelope gain at time fraction `t` (0…1) for the given control points. Outside
 * the points' range it holds the nearest end value. Both modes pass exactly
 * through every control point.
 */
export function gainEnvelopeAt(points: GainEnvelopePoint[], t: number, interpolation: "linear" | "spline" = "linear"): number {
  if (points.length === 0) return 1;
  if (points.length === 1) return points[0].gain;
  const pts = [...points].sort((a, b) => a.time - b.time);
  if (t <= pts[0].time) return pts[0].gain;
  const last = pts[pts.length - 1];
  if (t >= last.time) return last.gain;

  let i = 0;
  while (i < pts.length - 1 && t > pts[i + 1].time) i++;
  const a = pts[i];
  const b = pts[i + 1];
  const span = b.time - a.time;
  const local = span > 0 ? (t - a.time) / span : 0;
  if (interpolation === "linear") return a.gain * (1 - local) + b.gain * local;
  const p0 = pts[i - 1] ?? a;
  const p3 = pts[i + 2] ?? b;
  return catmullRom(p0.gain, a.gain, b.gain, p3.gain, local);
}

/**
 * Apply a time-varying gain envelope across the buffer. Every channel is scaled
 * by the same envelope; frame count is preserved and the input is not mutated.
 */
export function gainEnvelope(d: AudioData, opts: GainEnvelopeOptions = {}): AudioData {
  const points = opts.points ?? [];
  const out = cloneAudioData(d);
  const n = frameCount(d);
  if (n === 0 || points.length < 2) return out; // nothing to vary

  const interp = opts.interpolation ?? "linear";
  const gains = new Float32Array(n);
  for (let i = 0; i < n; i++) gains[i] = gainEnvelopeAt(points, n > 1 ? i / (n - 1) : 0, interp);
  for (const ch of out.channels) {
    for (let i = 0; i < n; i++) ch[i] *= gains[i];
  }
  return out;
}
