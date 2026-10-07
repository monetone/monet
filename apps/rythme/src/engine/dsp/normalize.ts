// ─────────────────────────────────────────────────────────────
// engine/dsp/normalize — peak & RMS normalization
// ─────────────────────────────────────────────────────────────

import { dbToGain } from "../audio/db";
import type { AudioData } from "../audio/types";
import { applyGainLinear } from "./gain";

/** Largest absolute sample across all channels (linear). */
export function peakAmplitude(d: AudioData): number {
  let peak = 0;
  for (const ch of d.channels) {
    for (let i = 0; i < ch.length; i++) {
      const a = Math.abs(ch[i]);
      if (a > peak) peak = a;
    }
  }
  return peak;
}

/** RMS across all channels (linear). */
export function rmsAmplitude(d: AudioData): number {
  let sum = 0;
  let count = 0;
  for (const ch of d.channels) {
    for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i];
    count += ch.length;
  }
  return count ? Math.sqrt(sum / count) : 0;
}

/**
 * Peak-normalize so the loudest sample sits at `targetDb` dBFS (default
 * -0.3 dB of headroom, like Audacity's default). Silent input is returned
 * unchanged.
 */
export function normalizePeak(d: AudioData, targetDb = -0.3): AudioData {
  const peak = peakAmplitude(d);
  if (peak === 0) return d;
  const target = dbToGain(targetDb);
  return applyGainLinear(d, target / peak);
}

/** RMS-normalize so the overall RMS reaches `targetDb` dBFS. */
export function normalizeRMS(d: AudioData, targetDb = -20): AudioData {
  const rms = rmsAmplitude(d);
  if (rms === 0) return d;
  return applyGainLinear(d, dbToGain(targetDb) / rms);
}

/** Remove DC offset by subtracting each channel's mean. */
export function removeDcOffset(d: AudioData): AudioData {
  const out: AudioData = { sampleRate: d.sampleRate, channels: d.channels.map((c) => c.slice()) };
  for (const ch of out.channels) {
    let mean = 0;
    for (let i = 0; i < ch.length; i++) mean += ch[i];
    mean /= ch.length || 1;
    for (let i = 0; i < ch.length; i++) ch[i] -= mean;
  }
  return out;
}
