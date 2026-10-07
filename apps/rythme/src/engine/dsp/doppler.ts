// ─────────────────────────────────────────────────────────────
// engine/dsp/doppler — Adobe Audition–style Doppler Shifter
// ─────────────────────────────────────────────────────────────
// Simulates a sound source travelling in a straight line past the listener:
// pitch rises as it approaches and falls as it recedes, while the volume swells
// to a peak at the closest point. Both effects fall out of the physics — the
// source is read through a variable delay equal to its propagation time, so the
// changing distance changes the read rate (that IS the Doppler pitch), and the
// amplitude follows the inverse-distance law.
//
// The source passes the listener at the buffer's midpoint (closest approach).
// Delay is taken RELATIVE to the closest approach so the centre stays in sync
// and only the change in distance bends the pitch. Pure `(AudioData, opts) =>
// AudioData`; the input is never mutated.

import { cloneAudioData, createAudioData } from "../audio/buffer";
import { channelCount, frameCount, type AudioData } from "../audio/types";

export interface DopplerOptions {
  /** Source speed in metres per second (higher = stronger pitch sweep). */
  speed?: number;
  /** Perpendicular distance at the closest point of approach, in metres. */
  closestDistance?: number;
  /** Speed of sound in metres per second (default 343, dry air at 20 °C). */
  speedOfSound?: number;
}

/** Linear-interpolated read of `ch` at fractional sample position `pos` (clamped). */
function readAt(ch: Float32Array, pos: number): number {
  if (pos <= 0) return ch[0];
  const last = ch.length - 1;
  if (pos >= last) return ch[last];
  const i0 = Math.floor(pos);
  const frac = pos - i0;
  return ch[i0] * (1 - frac) + ch[i0 + 1] * frac;
}

/**
 * Doppler shift a buffer as if its source flies past the listener. The output
 * keeps the input's channel count and frame count. `speed: 0` is a no-op
 * (a stationary source).
 */
export function doppler(d: AudioData, opts: DopplerOptions = {}): AudioData {
  const n = frameCount(d);
  const ch = channelCount(d);
  if (n === 0 || ch === 0) return cloneAudioData(d);

  const speed = opts.speed ?? 30;
  const closest = Math.max(1e-3, opts.closestDistance ?? 4);
  const c = Math.max(1, opts.speedOfSound ?? 343);
  if (speed === 0) return cloneAudioData(d);

  const sr = d.sampleRate;
  const halfDur = n / sr / 2; // closest approach at the midpoint
  const out = createAudioData(ch, n, sr);

  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const x = speed * (t - halfDur); // along-track position (0 at closest approach)
    const dist = Math.hypot(x, closest);
    const relDelaySamples = ((dist - closest) / c) * sr; // 0 at closest approach
    const readPos = i - relDelaySamples;
    const gain = closest / dist; // inverse-distance law, 1 at the closest point
    for (let cc = 0; cc < ch; cc++) out.channels[cc][i] = readAt(d.channels[cc], readPos) * gain;
  }
  return out;
}
