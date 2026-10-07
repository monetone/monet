// ─────────────────────────────────────────────────────────────
// engine/dsp/tube — Adobe Audition–style Tube-modeled Compressor
// ─────────────────────────────────────────────────────────────
// Vintage-flavoured compression: first a tube saturation stage adds the warm
// harmonic colour of a vacuum-tube gain stage, then a normal compressor evens
// the dynamics. The tube stage is an ASYMMETRIC tanh — a `warmth` bias offsets
// the operating point so the transfer curve is no longer odd-symmetric, which
// generates EVEN harmonics (the "warmth"), unlike the engine's symmetric
// soft-clip (odd harmonics only). The bias is subtracted back out so the stage
// adds no DC and passes small signals at unity. Pure `(AudioData, opts) =>
// AudioData`; the input is never mutated.

import { cloneAudioData, mapSamples } from "../audio/buffer";
import { clamp, clampSample, dbToGain } from "../audio/db";
import { frameCount, type AudioData } from "../audio/types";
import { compress, type CompressorAutomationOptions } from "./dynamics";

export interface TubeCompressorOptions {
  /** Saturation drive in dB (more = warmer/more harmonics). */
  driveDb?: number;
  /** Tube warmth 0…1 — asymmetry bias that adds even harmonics. */
  warmth?: number;
  // Compressor stage (forwarded to compress()):
  thresholdDb?: number;
  ratio?: number;
  attackMs?: number;
  releaseMs?: number;
  makeupDb?: number;
  automation?: TubeCompressorAutomationOptions;
}

type TubeCompressorParamResolver = (timeSeconds: number, fallback: number) => number;

export interface TubeCompressorAutomationOptions extends CompressorAutomationOptions {
  driveDb?: TubeCompressorParamResolver;
  warmth?: TubeCompressorParamResolver;
}

function saturateTube(sample: number, drive: number, bias: number): number {
  const tanhB = Math.tanh(drive * bias);
  // Slope at x=0 normalises the stage so small signals pass at ~unity gain.
  const slope = drive * (1 - tanhB * tanhB);
  const norm = Math.abs(slope) > 1e-6 ? slope : 1e-6;
  return clampSample((Math.tanh(drive * (sample + bias)) - tanhB) / norm);
}

/**
 * Tube-modeled compression: asymmetric saturation for warmth, then compression.
 * Output keeps the input's channel + frame count; the input is not mutated.
 */
export function tubeCompress(d: AudioData, opts: TubeCompressorOptions = {}): AudioData {
  if (frameCount(d) === 0) return cloneAudioData(d);

  const driveDb = clamp(opts.driveDb ?? 9, 0, 24);
  const drive = dbToGain(driveDb);
  const bias = clamp(opts.warmth ?? 0.3, 0, 1);
  const automation = opts.automation;
  const offset = automation?.offsetSeconds ?? 0;
  const hasTimeVaryingSaturation = !!(automation?.driveDb || automation?.warmth);

  const saturated = mapSamples(d, (x, frame) => {
    if (!hasTimeVaryingSaturation) return saturateTube(x, drive, bias);
    const time = offset + frame / d.sampleRate;
    const nextDrive = dbToGain(clamp(automation?.driveDb?.(time, driveDb) ?? driveDb, 0, 24));
    const nextBias = clamp(automation?.warmth?.(time, bias) ?? bias, 0, 1);
    return saturateTube(x, nextDrive, nextBias);
  });

  return compress(saturated, {
    thresholdDb: opts.thresholdDb ?? -18,
    ratio: opts.ratio ?? 3,
    attackMs: opts.attackMs ?? 10,
    releaseMs: opts.releaseMs ?? 150,
    makeupDb: opts.makeupDb ?? 0,
    automation: opts.automation,
  });
}
