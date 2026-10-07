// ─────────────────────────────────────────────────────────────
// engine/audio/types — the core sample-buffer type
// ─────────────────────────────────────────────────────────────
// AudioData is the one currency the whole engine trades in: planar
// (de-interleaved) 32-bit float PCM, one Float32Array per channel, sample
// values nominally in [-1, 1]. It is intentionally a plain data interface
// (not a class) so it serialises, clones and unit-tests trivially — every DSP,
// analysis, generator and IO function takes and returns AudioData.

export interface AudioData {
  /** Samples per second (e.g. 44100, 48000). */
  sampleRate: number;
  /** One Float32Array per channel; all channels share the same length. */
  channels: Float32Array[];
}

/** Frames (samples per channel) in a buffer. Empty buffer ⇒ 0. */
export function frameCount(d: AudioData): number {
  return d.channels.length ? d.channels[0].length : 0;
}

/** Number of channels (1 = mono, 2 = stereo, …). */
export function channelCount(d: AudioData): number {
  return d.channels.length;
}

/** Duration in seconds. */
export function durationSeconds(d: AudioData): number {
  return d.sampleRate > 0 ? frameCount(d) / d.sampleRate : 0;
}
