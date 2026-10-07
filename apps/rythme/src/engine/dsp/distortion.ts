// ─────────────────────────────────────────────────────────────
// engine/dsp/distortion — clipping, waveshaping, bitcrush
// ─────────────────────────────────────────────────────────────

import { cloneAudioData } from "../audio/buffer";
import { clampSample, dbToGain } from "../audio/db";
import { frameCount, type AudioData } from "../audio/types";
import { mapSamples } from "../audio/buffer";

/** Hard clip after a drive boost — aggressive, square-ish distortion. */
export function hardClip(d: AudioData, driveDb = 12, threshold = 1): AudioData {
  const drive = dbToGain(driveDb);
  const t = Math.max(1e-4, threshold);
  return mapSamples(d, (s) => {
    const v = s * drive;
    return v > t ? t : v < -t ? -t : v;
  });
}

/** Smooth tanh saturation — musical "warm" overdrive. */
export function softClip(d: AudioData, driveDb = 12): AudioData {
  const drive = dbToGain(driveDb);
  // normalise so unity input stays near unity output
  const norm = Math.tanh(drive) || 1;
  return mapSamples(d, (s) => Math.tanh(s * drive) / norm);
}

/** Arctangent overdrive with adjustable amount. */
export function overdrive(d: AudioData, amount = 5): AudioData {
  const k = Math.max(0.01, amount);
  const norm = Math.atan(k) || 1;
  return mapSamples(d, (s) => Math.atan(s * k) / norm);
}

/**
 * Bitcrusher: quantise to `bits` of resolution and decimate the sample rate by
 * `downsample` (sample-and-hold). bits ∈ [1, 16], downsample ≥ 1.
 */
export function bitcrush(d: AudioData, bits = 8, downsample = 1): AudioData {
  const levels = Math.pow(2, Math.max(1, Math.min(16, bits)));
  const step = 2 / levels;
  const hold = Math.max(1, Math.floor(downsample));
  const out = cloneAudioData(d);
  const n = frameCount(out);
  for (const ch of out.channels) {
    let held = 0;
    for (let i = 0; i < n; i++) {
      if (i % hold === 0) held = Math.round(ch[i] / step) * step;
      ch[i] = clampSample(held);
    }
  }
  return out;
}

/** Apply an arbitrary transfer function (waveshaper). */
export function waveshape(d: AudioData, shape: (sample: number) => number): AudioData {
  return mapSamples(d, (s) => clampSample(shape(s)));
}
