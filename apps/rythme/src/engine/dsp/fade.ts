// ─────────────────────────────────────────────────────────────
// engine/dsp/fade — fade in / out / crossfade ramps
// ─────────────────────────────────────────────────────────────

import { cloneAudioData, createAudioData } from "../audio/buffer";
import { channelCount, frameCount, frameCount as fc, type AudioData } from "../audio/types";
import type { FadeShape } from "../model/types";

/**
 * Gain at progress `t` (0 → 1) for a fade-IN of the given shape. A fade-out is
 * the mirror: `fadeGain(shape, 1 - t)`.
 */
export function fadeGain(shape: FadeShape, t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  switch (shape) {
    case "linear":
      return x;
    case "equalPower":
      return Math.sin((x * Math.PI) / 2);
    case "exponential":
      return x * x; // slow, gentle onset
    case "logarithmic":
      return Math.sqrt(x); // fast onset
  }
}

/** Fade in over the first `seconds` of the buffer. */
export function fadeIn(d: AudioData, seconds: number, shape: FadeShape = "equalPower"): AudioData {
  const out = cloneAudioData(d);
  const n = Math.min(frameCount(out), Math.round(seconds * out.sampleRate));
  if (n <= 0) return out;
  for (const ch of out.channels) {
    for (let i = 0; i < n; i++) ch[i] *= fadeGain(shape, i / n);
  }
  return out;
}

/** Fade out over the last `seconds` of the buffer. */
export function fadeOut(d: AudioData, seconds: number, shape: FadeShape = "equalPower"): AudioData {
  const out = cloneAudioData(d);
  const total = frameCount(out);
  const n = Math.min(total, Math.round(seconds * out.sampleRate));
  if (n <= 0) return out;
  const start = total - n;
  for (const ch of out.channels) {
    for (let i = 0; i < n; i++) ch[start + i] *= fadeGain(shape, 1 - i / n);
  }
  return out;
}

/**
 * Equal-power crossfade between the tail of `a` and the head of `b` over
 * `seconds`, producing a single buffer of length len(a)+len(b)-overlap. Both
 * inputs must share a sample rate; the wider channel count wins.
 */
export function crossfade(a: AudioData, b: AudioData, seconds: number, shape: FadeShape = "equalPower"): AudioData {
  if (a.sampleRate !== b.sampleRate) throw new Error("crossfade: sample-rate mismatch");
  const sr = a.sampleRate;
  const overlap = Math.min(fc(a), fc(b), Math.round(seconds * sr));
  const chN = Math.max(channelCount(a), channelCount(b));
  const aN = fc(a);
  const bN = fc(b);
  const total = aN + bN - overlap;
  const out = createAudioData(chN, total, sr);
  const ach = (c: number) => a.channels[Math.min(c, channelCount(a) - 1)];
  const bch = (c: number) => b.channels[Math.min(c, channelCount(b) - 1)];
  for (let c = 0; c < chN; c++) {
    const dst = out.channels[c];
    const as = ach(c);
    const bs = bch(c);
    // a's non-overlapping head
    for (let i = 0; i < aN - overlap; i++) dst[i] = as[i];
    // overlap region
    for (let i = 0; i < overlap; i++) {
      const t = overlap > 1 ? i / (overlap - 1) : 1;
      const ga = fadeGain(shape, 1 - t);
      const gb = fadeGain(shape, t);
      dst[aN - overlap + i] = as[aN - overlap + i] * ga + bs[i] * gb;
    }
    // b's non-overlapping tail
    for (let i = overlap; i < bN; i++) dst[aN - overlap + i] = bs[i];
  }
  return out;
}
