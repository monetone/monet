// ─────────────────────────────────────────────────────────────
// engine/dsp/analog-delay — Adobe Audition–style Analog Delay
// ─────────────────────────────────────────────────────────────
// A vintage feedback delay. Unlike the engine's clean delay(), every pass round
// the feedback loop is high-cut filtered (a one-pole lowpass at `toneHz`) and
// gently saturated, so each successive echo is darker and warmer than the last —
// the sound of tape, tube and bucket-brigade (BBD) delay units. The lowpass and
// the non-linearity sit INSIDE the feedback path, so their effect compounds with
// every repeat. Pure `(AudioData, opts) => AudioData`; the input is not mutated.

import { createAudioData } from "../audio/buffer";
import { clamp, clampSample, dbToGain } from "../audio/db";
import { channelCount, frameCount, type AudioData } from "../audio/types";

export type AnalogDelayMode = "tape" | "tube" | "bbd";

export interface AnalogDelayOptions {
  /** Delay time, ms. Default 300. */
  delayMs?: number;
  /** Feedback amount 0…<1 (clamped to 0.99). Default 0.4. */
  feedback?: number;
  /** Feedback-path lowpass corner, Hz — lower = darker repeats. Default 4000. */
  toneHz?: number;
  /** Saturation drive in the feedback path, dB. Default 6. */
  driveDb?: number;
  /** Saturation flavour. Default "tape". */
  mode?: AnalogDelayMode;
  /** Dry/wet mix, 0…1. Default 0.4. */
  mix?: number;
  /** Ring-out tail appended after the source, seconds. Default 1.5. */
  tailSeconds?: number;
  automation?: AnalogDelayAutomationOptions;
}

type AnalogDelayParamResolver = (timeSeconds: number, fallback: number) => number;

export interface AnalogDelayAutomationOptions {
  offsetSeconds?: number;
  delayMs?: AnalogDelayParamResolver;
  feedback?: AnalogDelayParamResolver;
  toneHz?: AnalogDelayParamResolver;
  driveDb?: AnalogDelayParamResolver;
  mix?: AnalogDelayParamResolver;
}

const MAX_DELAY_MS = 5000;
const TUBE_BIAS = 0.2;
const TUBE_OFFSET = Math.tanh(TUBE_BIAS);

function delaySamplesFromMs(ms: number, sampleRate: number): number {
  const safeMs = Number.isFinite(ms) ? clamp(ms, 1, MAX_DELAY_MS) : 1;
  return Math.max(1, Math.round((safeMs / 1000) * sampleRate));
}

/**
 * Per-mode soft saturation, near-unity at low level so `feedback` still governs
 * decay. `drive` is the LINEAR gain (from dbToGain), constrained to ≥ 1 by the
 * caller so the curve only ever compresses, never amplifies.
 */
function saturate(x: number, drive: number, mode: AnalogDelayMode): number {
  switch (mode) {
    case "tube": // asymmetric → even harmonics, vintage warmth
      return (Math.tanh(x * drive + TUBE_BIAS) - TUBE_OFFSET) / drive;
    case "bbd": // harder clip, the grittier bucket-brigade character
      return Math.tanh(1.5 * x * drive) / (1.5 * drive);
    case "tape":
    default:
      return Math.tanh(x * drive) / drive;
  }
}

/**
 * Analog (tape/tube/BBD) feedback delay. A tail is appended so trailing repeats
 * ring out; output length is n + tail. The input is not mutated.
 */
export function analogDelay(d: AudioData, opts: AnalogDelayOptions = {}): AudioData {
  const delayMs = Math.max(1, opts.delayMs ?? 300);
  const feedback = Math.min(0.99, Math.max(0, opts.feedback ?? 0.4));
  const toneHz = Math.max(200, opts.toneHz ?? 4000);
  const drive = dbToGain(Math.max(0, opts.driveDb ?? 6)); // ≥0 dB → saturator never amplifies
  const mode = opts.mode ?? "tape";
  const mix = Math.min(1, Math.max(0, opts.mix ?? 0.4));
  const sr = d.sampleRate;
  const delaySamples = Math.max(1, Math.round((delayMs / 1000) * sr));
  const tail = Math.round((opts.tailSeconds ?? 1.5) * sr);
  const n = frameCount(d);
  const ch = channelCount(d);
  const a = Math.exp((-2 * Math.PI * toneHz) / sr); // one-pole lowpass coefficient
  const automation = opts.automation;
  const offset = automation?.offsetSeconds ?? 0;
  const hasTimeVaryingDelay = !!automation?.delayMs;
  const hasTimeVaryingFeedback = !!automation?.feedback;
  const hasTimeVaryingTone = !!automation?.toneHz;
  const hasTimeVaryingDrive = !!automation?.driveDb;
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

  const out = createAudioData(ch, n + tail, sr);
  for (let c = 0; c < ch; c++) {
    const src = d.channels[c];
    const dst = out.channels[c];
    const line = new Float32Array(delaySamplesByFrame ? maxDelaySamples + 1 : delaySamples);
    let idx = 0;
    let lp = 0;
    for (let i = 0; i < n + tail; i++) {
      const time = offset + i / sr;
      const nextFeedback = hasTimeVaryingFeedback ? clamp(automation?.feedback?.(time, feedback) ?? feedback, 0, 0.99) : feedback;
      const nextToneHz = hasTimeVaryingTone ? clamp(automation?.toneHz?.(time, toneHz) ?? toneHz, 200, sr / 2 - 1) : toneHz;
      const nextA = hasTimeVaryingTone ? Math.exp((-2 * Math.PI * nextToneHz) / sr) : a;
      const nextDrive = hasTimeVaryingDrive ? dbToGain(clamp(automation?.driveDb?.(time, opts.driveDb ?? 6) ?? opts.driveDb ?? 6, 0, 36)) : drive;
      const nextMix = hasTimeVaryingMix ? clamp(automation?.mix?.(time, mix) ?? mix, 0, 1) : mix;
      const dry = i < n ? src[i] : 0;
      const readIdx = delaySamplesByFrame ? (idx - delaySamplesByFrame[i] + line.length) % line.length : idx;
      const delayed = line[readIdx];
      dst[i] = clampSample(dry * (1 - nextMix) + delayed * nextMix);
      // Feedback path: sum → high-cut (darken) → saturate (warm), then recirculate.
      // With mix automation, keep the line live even while the current output is dry
      // so later wet sections have the correct history.
      if (nextMix > 0 || hasTimeVaryingMix) {
        lp = (1 - nextA) * (dry + delayed * nextFeedback) + nextA * lp;
        line[idx] = saturate(lp, nextDrive, mode);
      }
      idx = (idx + 1) % line.length;
    }
  }
  return out;
}
