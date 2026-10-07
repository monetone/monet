// ─────────────────────────────────────────────────────────────
// engine/dsp/waveshaper — Adobe Audition–style Distortion (transfer-curve)
// ─────────────────────────────────────────────────────────────
// Audition's Distortion effect routes each instantaneous sample through an
// arbitrary input→output "distortion graph". `waveshaper` does the same: a
// point-based transfer curve in [-1, 1] is piecewise-linearly interpolated and
// applied per sample, generating harmonics. A `driveDb` pre-gain pushes the
// signal further into the curve's saturating ends; `mix` blends dry/wet.
// Distinct from the fixed soft/hard clippers (a single baked-in curve) and from
// dynamics-processing (a dB-domain, envelope-driven gain curve, not an
// instantaneous waveshaper). Pure `(AudioData, opts) => AudioData`; never
// mutates the input.

import { mapSamples } from "../audio/buffer";
import { clamp, clampSample, dbToGain } from "../audio/db";
import { type AudioData } from "../audio/types";

export interface CurvePoint {
  /** Input amplitude, in [-1, 1]. */
  in: number;
  /** Output amplitude the input maps to, in [-1, 1]. */
  out: number;
}

export interface WaveshaperOptions {
  /** Transfer curve points (sorted internally by input). Default identity. */
  curve?: CurvePoint[];
  /** Input gain applied before the curve, dB — drives the signal into the curve's saturating ends. Default 0. */
  driveDb?: number;
  /** Dry/wet blend, 0…1 (1 = fully shaped). Default 1. */
  mix?: number;
  automation?: WaveshaperAutomationOptions;
}

type WaveshaperParamResolver = (timeSeconds: number, fallback: number) => number;
type WaveshaperCurveResolver = (timeSeconds: number, fallback: CurvePoint[]) => CurvePoint[];

export interface WaveshaperAutomationOptions {
  offsetSeconds?: number;
  driveDb?: WaveshaperParamResolver;
  mix?: WaveshaperParamResolver;
  curve?: WaveshaperCurveResolver;
}

/** The straight-through curve used when none (or a degenerate one) is supplied. */
const IDENTITY: CurvePoint[] = [
  { in: -1, out: -1 },
  { in: 1, out: 1 },
];

/** Sort the curve by input, falling back to identity for fewer than two points. */
function normalizeCurve(curve?: CurvePoint[]): CurvePoint[] {
  if (!curve || curve.length < 2) return IDENTITY;
  return curve.slice().sort((a, b) => a.in - b.in);
}

/** Interpolate a pre-sorted curve at x (the per-sample hot path; no re-sort). */
function transfer(pts: CurvePoint[], x: number): number {
  const lo = pts[0];
  const hi = pts[pts.length - 1];
  if (x <= lo.in) return lo.out; // out-of-domain → saturate at the endpoint
  if (x >= hi.in) return hi.out;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (x <= b.in) {
      const span = b.in - a.in;
      return span === 0 ? b.out : a.out + ((x - a.in) / span) * (b.out - a.out);
    }
  }
  return hi.out;
}

/**
 * Map one input amplitude through a transfer curve by piecewise-linear
 * interpolation. Inputs outside the curve's domain saturate at the nearest
 * endpoint's output (Audition's distortion graph clamps its ends the same way).
 * A curve with fewer than two points falls back to identity. Duplicate input
 * x-values resolve deterministically (stable sort; the first matching segment
 * wins) and never produce NaN. Exported so tests can assert the transfer math
 * sample-exactly.
 *
 * @remarks Sorts the curve on each call. For per-sample use prefer `waveshaper`,
 * which hoists the sort out of the inner loop.
 */
export function waveshapeCurve(curve: CurvePoint[], x: number): number {
  return transfer(normalizeCurve(curve), x);
}

/**
 * Audition-style Distortion: drive each instantaneous sample through an
 * arbitrary input→output transfer curve, generating harmonics. The input is
 * clamped to the curve's domain after the drive pre-gain, shaped, blended with
 * the dry signal by `mix`, and bounded to [-1, 1].
 */
export function waveshaper(d: AudioData, opts: WaveshaperOptions = {}): AudioData {
  const pts = normalizeCurve(opts.curve);
  const driveDb = opts.driveDb ?? 0;
  const drive = dbToGain(driveDb);
  const mix = opts.mix ?? 1;
  const staticMix = clamp(mix, 0, 1);
  const automation = opts.automation;
  const offset = automation?.offsetSeconds ?? 0;
  const hasTimeVaryingDrive = !!automation?.driveDb;
  const hasTimeVaryingMix = !!automation?.mix;
  const hasTimeVaryingCurve = !!automation?.curve;
  return mapSamples(d, (s, frame) => {
    // A non-finite sample would poison the dry/wet blend: 0·NaN is NaN, so even
    // at mix 1 the dry term `(1 - mix) * s` would corrupt the output.
    if (!Number.isFinite(s)) return 0;
    const time = offset + frame / d.sampleRate;
    const nextDrive = hasTimeVaryingDrive ? dbToGain(automation?.driveDb?.(time, driveDb) ?? driveDb) : drive;
    const nextMix = hasTimeVaryingMix ? clamp(automation?.mix?.(time, mix) ?? mix, 0, 1) : staticMix;
    const nextPts = hasTimeVaryingCurve ? normalizeCurve(automation?.curve?.(time, pts) ?? pts) : pts;
    const shaped = transfer(nextPts, clamp(s * nextDrive, -1, 1));
    return clampSample((1 - nextMix) * s + nextMix * shaped);
  });
}
