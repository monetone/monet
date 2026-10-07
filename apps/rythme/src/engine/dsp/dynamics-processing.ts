// ─────────────────────────────────────────────────────────────
// engine/dsp/dynamics-processing — Adobe Audition–style Dynamics Processing
// ─────────────────────────────────────────────────────────────
// A general dynamics processor driven by an arbitrary transfer curve rather
// than a fixed threshold/ratio. The curve maps input level (dB) → output level
// (dB); the slope of each segment is the ratio at that level (slope 1 = no
// change, <1 = compression, >1 = expansion, 0 = limiting), so one curve can
// compress, expand, gate and limit at once. Two stages of ballistics, as in
// Audition: a stereo-LINKED peak Level Detector (attack/release on the envelope)
// feeds a Gain Processor (attack/release on the gain) so the gain is applied
// equally to every channel and the stereo image never shifts. Pure
// `(AudioData, opts) => AudioData`; the input is never mutated.

import { cloneAudioData } from "../audio/buffer";
import { clampSample, dbToGain, gainToDb } from "../audio/db";
import { channelCount, frameCount, type AudioData } from "../audio/types";

/** One control point on the transfer curve, in the dB domain. */
export interface DynamicsPoint {
  /** Input level (dBFS). */
  inputDb: number;
  /** Desired output level (dBFS) for that input. */
  outputDb: number;
}

export interface DynamicsProcessingOptions {
  /** Transfer curve (input dB → output dB). Defaults to identity (no change). */
  curve?: DynamicsPoint[];
  /** Level-detector attack time, ms (envelope rise). Default 5. */
  detectorAttackMs?: number;
  /** Level-detector release time, ms (envelope fall). Default 80. */
  detectorReleaseMs?: number;
  /** Gain-processor attack time, ms (gain reduction). Default 1. */
  gainAttackMs?: number;
  /** Gain-processor release time, ms (gain recovery). Default 50. */
  gainReleaseMs?: number;
  /** Output makeup gain, dB, applied after the curve. Default 0. */
  makeupDb?: number;
}

/** Identity curve: output equals input across the full dB range. */
const IDENTITY_CURVE: DynamicsPoint[] = [
  { inputDb: -120, outputDb: -120 },
  { inputDb: 0, outputDb: 0 },
];

/** Time-constant (ms) → one-pole smoothing coefficient. */
function coef(ms: number, sampleRate: number): number {
  const t = Math.max(ms, 0.01) / 1000;
  return Math.exp(-1 / (t * sampleRate));
}

/**
 * Sorted, validated curve with at least two points. A missing or single-point
 * curve falls back to identity (a curve needs two points to define a segment).
 */
function normalizeCurve(curve?: DynamicsPoint[]): DynamicsPoint[] {
  if (!curve || curve.length < 2) return IDENTITY_CURVE;
  return curve.slice().sort((a, b) => a.inputDb - b.inputDb);
}

/** Output dB on the line through a→b at input x (no clamping; extrapolates). */
function lineAt(a: DynamicsPoint, b: DynamicsPoint, x: number): number {
  const dx = b.inputDb - a.inputDb;
  if (dx === 0) return a.outputDb;
  return a.outputDb + ((x - a.inputDb) / dx) * (b.outputDb - a.outputDb);
}

/** Interpolate an already-sorted curve at input x (extends the end segments). */
function transferAt(pts: DynamicsPoint[], x: number): number {
  const last = pts.length - 1;
  if (x <= pts[0].inputDb) return lineAt(pts[0], pts[1], x);
  if (x >= pts[last].inputDb) return lineAt(pts[last - 1], pts[last], x);
  for (let i = 0; i < last; i++) {
    if (x <= pts[i + 1].inputDb) return lineAt(pts[i], pts[i + 1], x);
  }
  return lineAt(pts[last - 1], pts[last], x); // unreachable given the guards above
}

/**
 * Map an input level (dB) through a transfer curve to an output level (dB).
 * Piecewise-linear: exact at the control points, interpolated between them and
 * linearly extrapolated along the first/last segment beyond the ends. Duplicate
 * `inputDb` points are allowed and form a step: the first one (in sorted order)
 * governs the value exactly at that input, the next governs just above it.
 */
export function dynamicsTransferDb(curve: DynamicsPoint[], inputDb: number): number {
  return transferAt(normalizeCurve(curve), inputDb);
}

/**
 * Apply transfer-curve dynamics. The detected level (stereo-linked peak with
 * detector attack/release) is mapped through the curve; the resulting gain is
 * smoothed with gain-processor attack/release, offset by `makeupDb`, and applied
 * equally to all channels. Frame count is preserved and the input is not mutated.
 */
export function dynamicsProcessing(d: AudioData, opts: DynamicsProcessingOptions = {}): AudioData {
  const out = cloneAudioData(d);
  const n = frameCount(out);
  if (n === 0) return out;

  const pts = normalizeCurve(opts.curve);
  const sr = d.sampleRate;
  const aDet = coef(opts.detectorAttackMs ?? 5, sr);
  const rDet = coef(opts.detectorReleaseMs ?? 80, sr);
  const aGain = coef(opts.gainAttackMs ?? 1, sr);
  const rGain = coef(opts.gainReleaseMs ?? 50, sr);
  const makeupDb = opts.makeupDb ?? 0;
  const ch = channelCount(out);

  let env = 0;
  let gainDb = 0;
  for (let i = 0; i < n; i++) {
    // Stage 1 — stereo-linked peak level detector.
    let detect = 0;
    for (let c = 0; c < ch; c++) {
      const a = Math.abs(d.channels[c][i]);
      if (a > detect) detect = a;
    }
    env = detect > env ? aDet * env + (1 - aDet) * detect : rDet * env + (1 - rDet) * detect;

    // Stage 2 — gain computer + gain-processor smoothing.
    const levelDb = gainToDb(env);
    const desiredGainDb = transferAt(pts, levelDb) - levelDb;
    gainDb = desiredGainDb < gainDb ? aGain * gainDb + (1 - aGain) * desiredGainDb : rGain * gainDb + (1 - rGain) * desiredGainDb;

    const g = dbToGain(gainDb + makeupDb);
    for (let c = 0; c < ch; c++) out.channels[c][i] = clampSample(d.channels[c][i] * g);
  }
  return out;
}
