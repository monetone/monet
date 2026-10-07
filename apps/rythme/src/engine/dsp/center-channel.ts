// ─────────────────────────────────────────────────────────────
// engine/dsp/center-channel — Adobe Audition–style Center Channel Extractor
// ─────────────────────────────────────────────────────────────
// Keeps or removes audio that is common to both channels — i.e. panned dead
// center. Vocals, bass and lead instruments are usually recorded that way, so
// this is the classic "remove the vocals for a karaoke mix" (and the inverse,
// "isolate the vocals for an acapella") tool.
//
// It works on the mid/side decomposition: mid = (L+R)/2 carries the centered
// content, side = (L-R)/2 carries the stereo-spread content. Rebuilding with
// independent gains lets us null the centre (mode "remove") or null the sides
// (mode "keep"). An optional frequency range limits the processing to the vocal
// band so low bass stays intact. Pure `(AudioData, opts) => AudioData`; the
// output is always stereo and the input is never mutated.

import { setChannelCount } from "../audio/buffer";
import { dbToGain } from "../audio/db";
import { frameCount, type AudioData } from "../audio/types";
import { applyBiquad } from "./biquad";

export interface CenterChannelOptions {
  /** "remove" the center (karaoke, default) or "keep" it (acapella/isolate). */
  mode?: "remove" | "keep";
  /** Gain applied to the centered (mid) content, in dB. Lower = more removal. */
  centerLevelDb?: number;
  /** Gain applied to the stereo (side) content, in dB. */
  sideLevelDb?: number;
  /** Only process at/above this frequency (Hz); below it passes through. */
  lowFreq?: number;
  /** Only process at/below this frequency (Hz); above it passes through. */
  highFreq?: number;
  automation?: CenterChannelAutomationOptions;
}

type CenterChannelParamResolver = (timeSeconds: number, fallback: number) => number;

export interface CenterChannelAutomationOptions {
  offsetSeconds?: number;
  centerLevelDb?: CenterChannelParamResolver;
  sideLevelDb?: CenterChannelParamResolver;
}

/**
 * Extract or remove the center channel via mid/side processing. Returns a
 * stereo buffer (mono input is up-mixed first). With the defaults, "remove"
 * cancels centered content (karaoke) and "keep" isolates it (acapella).
 */
export function centerChannelExtract(d: AudioData, opts: CenterChannelOptions = {}): AudioData {
  const mode = opts.mode === "keep" ? "keep" : "remove";
  const centerGain = opts.centerLevelDb != null ? dbToGain(opts.centerLevelDb) : mode === "remove" ? 0 : 1;
  const sideGain = opts.sideLevelDb != null ? dbToGain(opts.sideLevelDb) : mode === "remove" ? 1 : 0;
  const automation = opts.automation;
  const offset = automation?.offsetSeconds ?? 0;
  const centerFallbackDb = opts.centerLevelDb ?? (mode === "remove" ? -80 : 0);
  const sideFallbackDb = opts.sideLevelDb ?? (mode === "remove" ? 0 : -80);

  const stereo = setChannelCount(d, 2);
  const n = frameCount(stereo);
  if (n === 0) return stereo;

  const L = stereo.channels[0];
  const R = stereo.channels[1];
  const outL = new Float32Array(n);
  const outR = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const time = offset + i / stereo.sampleRate;
    const nextCenterGain = automation?.centerLevelDb ? dbToGain(automation.centerLevelDb(time, centerFallbackDb)) : centerGain;
    const nextSideGain = automation?.sideLevelDb ? dbToGain(automation.sideLevelDb(time, sideFallbackDb)) : sideGain;
    const mid = (L[i] + R[i]) / 2;
    const side = (L[i] - R[i]) / 2;
    outL[i] = nextCenterGain * mid + nextSideGain * side;
    outR[i] = nextCenterGain * mid - nextSideGain * side;
  }

  const nyquist = stereo.sampleRate / 2;
  const useLow = opts.lowFreq != null && opts.lowFreq > 0;
  const useHigh = opts.highFreq != null && opts.highFreq < nyquist;
  if (!useLow && !useHigh) {
    return { sampleRate: d.sampleRate, channels: [outL, outR] };
  }

  // Frequency range: apply the change (processed − original) only within the
  // band, so out-of-band content (e.g. bass below the vocal range) is untouched.
  let diff: AudioData = {
    sampleRate: d.sampleRate,
    channels: [outL.map((v, i) => v - L[i]), outR.map((v, i) => v - R[i])],
  };
  if (useLow) diff = applyBiquad(diff, { type: "highpass", freq: opts.lowFreq! });
  if (useHigh) diff = applyBiquad(diff, { type: "lowpass", freq: opts.highFreq! });
  return {
    sampleRate: d.sampleRate,
    channels: [diff.channels[0].map((v, i) => L[i] + v), diff.channels[1].map((v, i) => R[i] + v)],
  };
}
