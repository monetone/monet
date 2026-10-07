// ─────────────────────────────────────────────────────────────
// engine/dsp/gain — amplitude scaling
// ─────────────────────────────────────────────────────────────

import { cloneAudioData } from "../audio/buffer";
import { clampSample, dbToGain } from "../audio/db";
import type { AudioData } from "../audio/types";

/** Multiply every sample by a linear factor. */
export function applyGainLinear(d: AudioData, factor: number, hardClip = false): AudioData {
  const out = cloneAudioData(d);
  for (const ch of out.channels) {
    for (let i = 0; i < ch.length; i++) {
      const v = ch[i] * factor;
      ch[i] = hardClip ? clampSample(v) : v;
    }
  }
  return out;
}

/** Amplify by a dB amount (Audacity "Amplify" / "Gain"). */
export function applyGainDb(d: AudioData, db: number, hardClip = false): AudioData {
  return applyGainLinear(d, dbToGain(db), hardClip);
}
