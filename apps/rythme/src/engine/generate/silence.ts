// ─────────────────────────────────────────────────────────────
// engine/generate/silence — silent buffers
// ─────────────────────────────────────────────────────────────

import { createAudioData } from "../audio/buffer";
import type { AudioData } from "../audio/types";
import { DEFAULT_SAMPLE_RATE } from "../model/factory";

export function generateSilence(seconds: number, channels = 1, sampleRate = DEFAULT_SAMPLE_RATE): AudioData {
  return createAudioData(channels, Math.max(0, Math.round(seconds * sampleRate)), sampleRate);
}
