// ─────────────────────────────────────────────────────────────
// engine/dsp/basic — reverse, invert, silence, stereo helpers
// ─────────────────────────────────────────────────────────────

import { cloneAudioData, createAudioData, setChannelCount } from "../audio/buffer";
import { clamp } from "../audio/db";
import { channelCount, frameCount, type AudioData } from "../audio/types";

/** Reverse the buffer in time (per channel). */
export function reverse(d: AudioData): AudioData {
  const out = cloneAudioData(d);
  for (const ch of out.channels) ch.reverse();
  return out;
}

/** Invert polarity (multiply by -1). */
export function invertPolarity(d: AudioData): AudioData {
  const out = cloneAudioData(d);
  for (const ch of out.channels) for (let i = 0; i < ch.length; i++) ch[i] = -ch[i];
  return out;
}

/** Replace contents with silence, keeping shape. */
export function silence(d: AudioData): AudioData {
  return createAudioData(channelCount(d), frameCount(d), d.sampleRate);
}

/** Swap left and right channels (stereo only; otherwise unchanged). */
export function swapStereo(d: AudioData): AudioData {
  if (channelCount(d) !== 2) return cloneAudioData(d);
  return { sampleRate: d.sampleRate, channels: [d.channels[1].slice(), d.channels[0].slice()] };
}

/**
 * Constant-power stereo pan. Mono input is first up-mixed. pan ∈ [-1, 1].
 * Returns a stereo buffer.
 */
export function applyPan(d: AudioData, pan: number): AudioData {
  const st = setChannelCount(d, 2);
  const p = clamp(pan, -1, 1);
  const angle = ((p + 1) / 2) * (Math.PI / 2); // 0..π/2
  const gl = Math.cos(angle);
  const gr = Math.sin(angle);
  for (let i = 0; i < st.channels[0].length; i++) {
    st.channels[0][i] *= gl;
    st.channels[1][i] *= gr;
  }
  return st;
}

/**
 * Adjust stereo width: 0 = mono (sum), 1 = unchanged, >1 = wider via the
 * mid/side trick. Mono input is returned unchanged.
 */
export function stereoWidth(d: AudioData, width: number): AudioData {
  if (channelCount(d) !== 2) return cloneAudioData(d);
  const out = cloneAudioData(d);
  const [l, r] = out.channels;
  for (let i = 0; i < l.length; i++) {
    const mid = (l[i] + r[i]) / 2;
    const side = ((l[i] - r[i]) / 2) * width;
    l[i] = mid + side;
    r[i] = mid - side;
  }
  return out;
}
