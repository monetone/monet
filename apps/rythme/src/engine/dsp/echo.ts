// ─────────────────────────────────────────────────────────────
// engine/dsp/echo — Adobe Audition–style Echo (successive echo equalization)
// ─────────────────────────────────────────────────────────────
// A feedback echo whose defining feature is "Successive Echo Equalization": a
// graphic EQ sits in the feedback path, so every repeat is filtered AGAIN and the
// echoes accumulate the EQ — they darken (or brighten) progressively over time.
// The linear feedback loop y = x + fb·EQ(delay(y)) expands into a sum of taps:
//   echo_k = feedback^k · EQ^k(x)   placed at delay k·delayMs   (k = 1, 2, …)
// where EQ^k is the graphic EQ applied k times (cumulative). The output is
// dry + mix·Σ echo_k, clamped to [-1, 1], with an appended tail so the repeats
// ring out. With a flat EQ this is a clean multi-tap delay; with a high-cut EQ it
// is a tape-style echo. Distinct from Delay (plain feedback) and Analog Delay
// (a single low-pass in the feedback). Pure `(AudioData, opts) => AudioData`; the
// input is never mutated.

import { createAudioData } from "../audio/buffer";
import { clamp, clampSample } from "../audio/db";
import { channelCount, frameCount, type AudioData } from "../audio/types";
import { designBiquad } from "./biquad";
import { graphicEQ, GRAPHIC_EQ_FREQS } from "./eq";

export interface EchoOptions {
  /** Time between successive repeats, ms. Default 300. */
  delayMs?: number;
  /** Echo decay per repeat, 0…<1 (clamped to 0.95). Default 0.5. */
  feedback?: number;
  /** Wet/dry mix — echoes are scaled by this and added to the full dry signal. Default 0.5. */
  mix?: number;
  /** Per-band gains (dB) of the EQ applied to each successive echo; cumulative. Default a gentle high-cut (darkening). */
  eqGainsDb?: number[];
  /** Band centers (Hz) for the successive-echo EQ. Default the 10 ISO octave centers. */
  eqFreqs?: number[];
  /** Extra tail length, seconds, so trailing repeats are not truncated. Default 1.5. */
  tailSeconds?: number;
  automation?: EchoAutomationOptions;
}

type EchoParamResolver = (timeSeconds: number, fallback: number) => number;

export interface EchoAutomationOptions {
  offsetSeconds?: number;
  delayMs?: EchoParamResolver;
  feedback?: EchoParamResolver;
  mix?: EchoParamResolver;
  eqGainsDb?: (EchoParamResolver | undefined)[];
}

const MAX_DELAY_MS = 5000;
/** Below this echo amplitude the remaining repeats are inaudible — stop accumulating taps. */
const TAP_FLOOR = 1e-4;
/** Hard cap on the number of taps (a backstop for very high feedback). */
const MAX_TAPS = 256;
/**
 * If a band has positive gain, the cumulative EQ (re-filtered each tap) compounds
 * geometrically and the feedback path is unstable. Once the filtered peak passes
 * this bound it can only overflow, and its contribution is clamped to ±1 anyway —
 * stop accumulating. (Cut-only EQs decay and never approach this.)
 */
const DIVERGE_BOUND = 1e3;

/** A gentle progressive high-cut so repeats darken like a tape echo (matches GRAPHIC_EQ_FREQS order). */
const DEFAULT_ECHO_EQ = [0, 0, 0, 0, 0, -1, -3, -6, -9, -12];

/** Clamp every sample to [-1, 1] in place, mapping any non-finite value to 0 (a divergent feedback path, or non-finite caller input, can never escape). */
function clampSanitize(d: AudioData): void {
  for (const ch of d.channels) {
    for (let i = 0; i < ch.length; i++) {
      const v = clampSample(ch[i]);
      ch[i] = Number.isFinite(v) ? v : 0;
    }
  }
}

function delaySamplesFromMs(ms: number, sampleRate: number): number {
  const safeMs = Number.isFinite(ms) ? clamp(ms, 1, MAX_DELAY_MS) : 1;
  return Math.max(1, Math.round((safeMs / 1000) * sampleRate));
}

function hasEqGainAutomation(automation: EchoAutomationOptions | undefined): boolean {
  return !!automation?.eqGainsDb?.some(Boolean);
}

function dynamicGraphicEQ(
  d: AudioData,
  gainsDb: number[],
  freqs: number[],
  resolvers: (EchoParamResolver | undefined)[],
  offsetSeconds: number,
  outputShiftSamples: number,
): AudioData {
  let out = d;
  for (let band = 0; band < gainsDb.length && band < freqs.length; band++) {
    const resolver = resolvers[band];
    const fallback = gainsDb[band] ?? 0;
    if (!resolver && Math.abs(fallback) < 1e-3) continue;
    const next = createAudioData(channelCount(out), frameCount(out), out.sampleRate);
    for (let c = 0; c < out.channels.length; c++) {
      const src = out.channels[c];
      const dst = next.channels[c];
      let z1 = 0;
      let z2 = 0;
      for (let i = 0; i < src.length; i++) {
        const time = offsetSeconds + (i + outputShiftSamples) / out.sampleRate;
        const gainDb = resolver ? clamp(resolver(time, fallback), -36, 36) : fallback;
        const coeffs = designBiquad({ type: "peaking", freq: freqs[band], q: 1.4, gainDb }, out.sampleRate);
        const x = src[i];
        const y = coeffs.b0 * x + z1;
        z1 = coeffs.b1 * x - coeffs.a1 * y + z2;
        z2 = coeffs.b2 * x - coeffs.a2 * y;
        dst[i] = y;
      }
    }
    out = next;
  }
  return out;
}

/**
 * Multi-tap feedback echo with successive (cumulative) equalization. The output
 * length is n + tail; the input is not mutated.
 */
export function echo(d: AudioData, opts: EchoOptions = {}): AudioData {
  const sr = d.sampleRate;
  const n = frameCount(d);
  const ch = channelCount(d);
  if (n === 0) return createAudioData(ch, 0, sr); // empty in → empty out
  const delaySamples = Math.max(1, Math.round(((opts.delayMs ?? 300) / 1000) * sr));
  const feedback = Math.min(0.95, Math.max(0, opts.feedback ?? 0.5));
  const mix = Math.min(1, Math.max(0, opts.mix ?? 0.5));
  const eqGains = opts.eqGainsDb ?? DEFAULT_ECHO_EQ;
  const eqFreqs = opts.eqFreqs ?? GRAPHIC_EQ_FREQS;
  const tail = Math.max(0, Math.round((opts.tailSeconds ?? 1.5) * sr));
  const automation = opts.automation;
  const offset = automation?.offsetSeconds ?? 0;
  const hasTimeVaryingDelay = !!automation?.delayMs;
  const hasTimeVaryingFeedback = !!automation?.feedback;
  const hasTimeVaryingMix = !!automation?.mix;
  const hasTimeVaryingEq = hasEqGainAutomation(automation);
  const delaySamplesByFrame = hasTimeVaryingDelay ? new Int32Array(n + tail) : undefined;
  let minDelaySamples = delaySamples;
  if (delaySamplesByFrame) {
    for (let i = 0; i < n + tail; i++) {
      const time = offset + i / sr;
      const nextDelaySamples = delaySamplesFromMs(automation?.delayMs?.(time, opts.delayMs ?? 300) ?? opts.delayMs ?? 300, sr);
      delaySamplesByFrame[i] = nextDelaySamples;
      minDelaySamples = Math.min(minDelaySamples, nextDelaySamples);
    }
  }

  const out = createAudioData(ch, n + tail, sr);
  // Start with the full dry signal.
  for (let c = 0; c < ch; c++) {
    const src = d.channels[c];
    const dst = out.channels[c];
    for (let i = 0; i < n; i++) dst[i] = src[i];
  }
  if ((feedback === 0 || mix === 0) && !hasTimeVaryingFeedback && !hasTimeVaryingMix) {
    // No repeats to add (or fully dry) — return the clamped dry-in-place output.
    clampSanitize(out);
    return out;
  }

  // How many taps stay above the audible floor (also bounded by the tail length and a hard cap).
  let taps = hasTimeVaryingFeedback ? MAX_TAPS : Math.ceil(Math.log(TAP_FLOOR) / Math.log(feedback));
  if (!Number.isFinite(taps) || taps < 1) taps = 1;
  taps = Math.min(taps, MAX_TAPS, Math.ceil((n + tail) / minDelaySamples));

  // filtered carries EQ^k(input): re-filter the running signal once per tap (cumulative EQ).
  let filtered: AudioData = d;
  let gain = 1;
  const automationGain = hasTimeVaryingFeedback ? new Float64Array(n).fill(1) : undefined;
  for (let k = 1; k <= taps; k++) {
    filtered = hasTimeVaryingEq
      ? dynamicGraphicEQ(filtered, eqGains, eqFreqs, automation?.eqGainsDb ?? [], offset, k * delaySamples)
      : graphicEQ(filtered, eqGains, eqFreqs);
    gain *= feedback;
    if (delaySamplesByFrame) {
      let tapPeak = 0;
      for (let c = 0; c < ch; c++) {
        const fch = filtered.channels[c];
        const dst = out.channels[c];
        for (let outputIndex = 0; outputIndex < n + tail; outputIndex++) {
          const nextDelaySamples = delaySamplesByFrame[outputIndex];
          const sourceIndex = outputIndex - k * nextDelaySamples;
          if (sourceIndex < 0 || sourceIndex >= n) continue;
          const time = offset + outputIndex / sr;
          const feedbackGain = hasTimeVaryingFeedback
            ? dynamicTapFeedbackGain(automation?.feedback, offset, sourceIndex, nextDelaySamples, k, sr, feedback)
            : gain;
          const wetGain = (hasTimeVaryingMix ? clamp(automation?.mix?.(time, mix) ?? mix, 0, 1) : mix) * feedbackGain;
          const fv = fch[sourceIndex];
          const a = fv < 0 ? -fv : fv;
          if (a > tapPeak) tapPeak = a;
          dst[outputIndex] += wetGain * fv;
        }
      }
      if (!(tapPeak < DIVERGE_BOUND)) break;
      continue;
    }
    const shift = k * delaySamples;
    if (shift >= n + tail) break;
    const limit = Math.min(n, (n + tail) - shift);
    if (automationGain) {
      for (let i = 0; i < limit; i++) {
        const outputIndex = i + shift;
        const time = offset + outputIndex / sr;
        automationGain[i] *= clamp(automation?.feedback?.(time, feedback) ?? feedback, 0, 0.95);
      }
    }
    let tapPeak = 0;
    for (let c = 0; c < ch; c++) {
      const fch = filtered.channels[c];
      const dst = out.channels[c];
      for (let i = 0; i < limit; i++) {
        const outputIndex = i + shift;
        const time = offset + outputIndex / sr;
        const feedbackGain = automationGain ? automationGain[i] : gain;
        const wetGain = (hasTimeVaryingMix ? clamp(automation?.mix?.(time, mix) ?? mix, 0, 1) : mix) * feedbackGain;
        const fv = fch[i];
        const a = fv < 0 ? -fv : fv;
        if (a > tapPeak) tapPeak = a;
        dst[outputIndex] += wetGain * fv;
      }
    }
    // Stop if the cumulative EQ is diverging (positive-gain feedback). The negated
    // comparison also breaks on a NaN/Infinity peak.
    if (!(tapPeak < DIVERGE_BOUND)) break;
  }

  clampSanitize(out);
  return out;
}

function dynamicTapFeedbackGain(
  feedbackAutomation: EchoParamResolver | undefined,
  offsetSeconds: number,
  sourceIndex: number,
  delaySamples: number,
  tap: number,
  sampleRate: number,
  fallback: number,
): number {
  if (!feedbackAutomation) return Math.pow(fallback, tap);
  let gain = 1;
  for (let k = 1; k <= tap; k++) {
    const time = offsetSeconds + (sourceIndex + k * delaySamples) / sampleRate;
    gain *= clamp(feedbackAutomation(time, fallback), 0, 0.95);
  }
  return gain;
}
