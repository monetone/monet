// ─────────────────────────────────────────────────────────────
// engine/dsp/channel-mixer — Adobe Audition–style Channel Mixer
// ─────────────────────────────────────────────────────────────
// Re-balances a stereo signal through a 2×2 mix matrix: each output channel is
// a weighted blend (in percent) of the two input channels. Negative percentages
// invert phase. It generalises the fixed swap / mono-fold / width helpers — and
// because the matrix is arbitrary it also does Mid/Side encode/decode
// (Stereo→M/S: mid=(L+R)/2 on the left, side=(L−R)/2 on the right). Mono input
// is up-mixed first so the output is always stereo. Pure `(AudioData, opts) =>
// AudioData`; the input is never mutated.

import { createAudioData, setChannelCount } from "../audio/buffer";
import { frameCount, type AudioData } from "../audio/types";

export interface ChannelMixerOptions {
  /** Percent of the left input sent to the left output (default 100). */
  leftToLeft?: number;
  /** Percent of the right input sent to the left output (default 0). */
  rightToLeft?: number;
  /** Percent of the left input sent to the right output (default 0). */
  leftToRight?: number;
  /** Percent of the right input sent to the right output (default 100). */
  rightToRight?: number;
  automation?: ChannelMixerAutomationOptions;
}

type ChannelMixerParamResolver = (timeSeconds: number, fallback: number) => number;

export interface ChannelMixerAutomationOptions {
  offsetSeconds?: number;
  leftToLeft?: ChannelMixerParamResolver;
  rightToLeft?: ChannelMixerParamResolver;
  leftToRight?: ChannelMixerParamResolver;
  rightToRight?: ChannelMixerParamResolver;
}

/**
 * Mix the stereo channels through a 2×2 matrix. Output is always stereo (mono is
 * up-mixed first); frame count is preserved and the input is not mutated.
 */
export function channelMixer(d: AudioData, opts: ChannelMixerOptions = {}): AudioData {
  const n = frameCount(d);
  if (n === 0) return createAudioData(2, 0, d.sampleRate);

  const leftToLeft = opts.leftToLeft ?? 100;
  const rightToLeft = opts.rightToLeft ?? 0;
  const leftToRight = opts.leftToRight ?? 0;
  const rightToRight = opts.rightToRight ?? 100;
  const ll = leftToLeft / 100;
  const rl = rightToLeft / 100;
  const lr = leftToRight / 100;
  const rr = rightToRight / 100;
  const automation = opts.automation;
  const offset = automation?.offsetSeconds ?? 0;

  // Already-stereo input is read directly (output goes to fresh arrays, so this
  // is mutation-safe); mono/other counts are up-mixed to a stereo pair first.
  const stereo = d.channels.length === 2 ? d : setChannelCount(d, 2);
  const L = stereo.channels[0];
  const R = stereo.channels[1];
  const outL = new Float32Array(n);
  const outR = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const time = offset + i / d.sampleRate;
    const nextLl = automation?.leftToLeft ? automation.leftToLeft(time, leftToLeft) / 100 : ll;
    const nextRl = automation?.rightToLeft ? automation.rightToLeft(time, rightToLeft) / 100 : rl;
    const nextLr = automation?.leftToRight ? automation.leftToRight(time, leftToRight) / 100 : lr;
    const nextRr = automation?.rightToRight ? automation.rightToRight(time, rightToRight) / 100 : rr;
    const l = L[i];
    const r = R[i];
    outL[i] = nextLl * l + nextRl * r;
    outR[i] = nextLr * l + nextRr * r;
  }
  return { sampleRate: d.sampleRate, channels: [outL, outR] };
}
