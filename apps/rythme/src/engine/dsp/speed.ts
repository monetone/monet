// ─────────────────────────────────────────────────────────────
// engine/dsp/speed — playback-speed / pitch change by resampling
// ─────────────────────────────────────────────────────────────
// Audacity "Change Speed": resample the content while keeping the declared
// sample rate, so a factor > 1 makes audio shorter and higher-pitched. This is
// a coupled speed+pitch change (no time-stretch), which is honest and cheap.

import { createAudioData } from "../audio/buffer";
import { channelCount, frameCount, type AudioData } from "../audio/types";

/**
 * Change speed by `factor` (2 = twice as fast & an octave up, 0.5 = half speed
 * & an octave down). Sample rate is preserved; length scales by 1/factor.
 */
export function changeSpeed(d: AudioData, factor: number): AudioData {
  if (factor <= 0) throw new Error("changeSpeed: factor must be > 0");
  if (factor === 1) return { sampleRate: d.sampleRate, channels: d.channels.map((c) => c.slice()) };
  const n = frameCount(d);
  const outN = Math.max(0, Math.round(n / factor));
  const out = createAudioData(channelCount(d), outN, d.sampleRate);
  for (let c = 0; c < channelCount(d); c++) {
    const src = d.channels[c];
    const dst = out.channels[c];
    for (let i = 0; i < outN; i++) {
      const pos = i * factor;
      const i0 = Math.floor(pos);
      const i1 = Math.min(n - 1, i0 + 1);
      const frac = pos - i0;
      dst[i] = src[i0] * (1 - frac) + src[i1] * frac;
    }
  }
  return out;
}

/** Convert a semitone shift to a speed factor (for "Change Pitch" coupled mode). */
export function semitonesToFactor(semitones: number): number {
  return Math.pow(2, semitones / 12);
}
