// ─────────────────────────────────────────────────────────────
// engine/dsp/delay — feedback delay / echo + convolution
// ─────────────────────────────────────────────────────────────

import { cloneAudioData, createAudioData } from "../audio/buffer";
import { clamp } from "../audio/db";
import { channelCount, frameCount, type AudioData } from "../audio/types";

export interface DelayOptions {
  delayMs?: number;
  /** Feedback amount 0…<1 (≥1 would self-oscillate; clamped to 0.99). */
  feedback?: number;
  /** Wet/dry mix 0 (dry) … 1 (wet). */
  mix?: number;
  /** Extra tail length in seconds so echoes ring out past the source. */
  tailSeconds?: number;
  automation?: DelayAutomationOptions;
}

type DelayParamResolver = (timeSeconds: number, fallback: number) => number;

export interface DelayAutomationOptions {
  offsetSeconds?: number;
  delayMs?: DelayParamResolver;
  feedback?: DelayParamResolver;
  mix?: DelayParamResolver;
}

const MAX_DELAY_MS = 5000;

function delaySamplesFromMs(ms: number, sampleRate: number): number {
  const safeMs = Number.isFinite(ms) ? clamp(ms, 1, MAX_DELAY_MS) : 1;
  return Math.max(1, Math.round((safeMs / 1000) * sampleRate));
}

/**
 * Mono/stereo feedback delay (echo). A tail is appended so trailing repeats are
 * not truncated. Each channel has its own delay line.
 */
export function delay(d: AudioData, opts: DelayOptions = {}): AudioData {
  const delayMs = Math.max(1, opts.delayMs ?? 250);
  const feedback = Math.min(0.99, Math.max(0, opts.feedback ?? 0.35));
  const mix = Math.min(1, Math.max(0, opts.mix ?? 0.35));
  const sr = d.sampleRate;
  const delaySamples = Math.max(1, Math.round((delayMs / 1000) * sr));
  const tail = Math.round((opts.tailSeconds ?? 1.5) * sr);
  const n = frameCount(d);
  const ch = channelCount(d);
  const out = createAudioData(ch, n + tail, sr);
  const automation = opts.automation;
  const offset = automation?.offsetSeconds ?? 0;
  const hasTimeVaryingDelay = !!automation?.delayMs;
  const hasTimeVaryingFeedback = !!automation?.feedback;
  const hasTimeVaryingMix = !!automation?.mix;
  const delaySamplesByFrame = hasTimeVaryingDelay ? new Int32Array(n + tail) : undefined;
  let maxDelaySamples = delaySamples;
  if (delaySamplesByFrame) {
    for (let i = 0; i < n + tail; i++) {
      const time = offset + i / sr;
      const nextDelaySamples = delaySamplesFromMs(automation?.delayMs?.(time, delayMs) ?? delayMs, sr);
      delaySamplesByFrame[i] = nextDelaySamples;
      maxDelaySamples = Math.max(maxDelaySamples, nextDelaySamples);
    }
  }
  for (let c = 0; c < ch; c++) {
    const src = d.channels[c];
    const dst = out.channels[c];
    const line = new Float32Array(delaySamplesByFrame ? maxDelaySamples + 1 : delaySamples);
    let idx = 0;
    for (let i = 0; i < n + tail; i++) {
      const time = offset + i / sr;
      const nextFeedback = hasTimeVaryingFeedback ? clamp(automation?.feedback?.(time, feedback) ?? feedback, 0, 0.99) : feedback;
      const nextMix = hasTimeVaryingMix ? clamp(automation?.mix?.(time, mix) ?? mix, 0, 1) : mix;
      const dry = i < n ? src[i] : 0;
      const readIdx = delaySamplesByFrame ? (idx - delaySamplesByFrame[i] + line.length) % line.length : idx;
      const delayed = line[readIdx];
      const outSample = dry * (1 - nextMix) + delayed * nextMix;
      line[idx] = dry + delayed * nextFeedback;
      idx = (idx + 1) % line.length;
      dst[i] = outSample;
    }
  }
  return out;
}

/**
 * Direct convolution of each channel with `impulse` (a mono kernel). O(N·M) —
 * intended for short kernels (custom IRs, FIR tests), not multi-second reverb
 * tails. Output length is N+M-1.
 */
export function convolve(d: AudioData, impulse: Float32Array, mix = 1): AudioData {
  const n = frameCount(d);
  const m = impulse.length;
  if (m === 0) return cloneAudioData(d);
  const ch = channelCount(d);
  const out = createAudioData(ch, n + m - 1, d.sampleRate);
  for (let c = 0; c < ch; c++) {
    const src = d.channels[c];
    const dst = out.channels[c];
    for (let i = 0; i < n; i++) {
      const x = src[i];
      if (x === 0) continue;
      for (let k = 0; k < m; k++) dst[i + k] += x * impulse[k];
    }
    if (mix < 1) {
      for (let i = 0; i < dst.length; i++) {
        const dry = i < n ? src[i] : 0;
        dst[i] = dry * (1 - mix) + dst[i] * mix;
      }
    }
  }
  return out;
}
