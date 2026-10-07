// ─────────────────────────────────────────────────────────────
// engine/dsp/reverb — Freeverb (Schroeder) algorithmic reverb
// ─────────────────────────────────────────────────────────────
// Jezar's Freeverb: eight parallel lowpass-feedback comb filters into four
// series allpass filters per channel, with a small inter-channel stereo spread.
// Tunings are scaled from their 44.1 kHz originals to the buffer's rate.

import { setChannelCount } from "../audio/buffer";
import { frameCount, type AudioData } from "../audio/types";

const COMB_TUNING = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASS_TUNING = [556, 441, 341, 225];
const STEREO_SPREAD = 23;
const FIXED_GAIN = 0.015;

export interface ReverbOptions {
  /** Tail length / room size 0…1. */
  roomSize?: number;
  /** High-frequency damping 0…1. */
  damping?: number;
  /** Wet level 0…1. */
  wet?: number;
  /** Dry level 0…1. */
  dry?: number;
  /** Extra tail in seconds appended so the reverb rings out. */
  tailSeconds?: number;
  automation?: ReverbAutomationOptions;
}

type ReverbParamResolver = (timeSeconds: number, fallback: number) => number;

export interface ReverbAutomationOptions {
  offsetSeconds?: number;
  roomSize?: ReverbParamResolver;
  damping?: ReverbParamResolver;
}

function coefficientAt(value: number | Float64Array, index: number): number {
  return value instanceof Float64Array ? value[index] : value;
}

function comb(input: Float32Array, size: number, feedback: number | Float64Array, damp: number | Float64Array): Float32Array {
  const buf = new Float32Array(size);
  const out = new Float32Array(input.length);
  let idx = 0;
  let filterStore = 0;
  for (let i = 0; i < input.length; i++) {
    const y = buf[idx];
    const nextDamp = coefficientAt(damp, i);
    const nextFeedback = coefficientAt(feedback, i);
    filterStore = y * (1 - nextDamp) + filterStore * nextDamp;
    buf[idx] = input[i] + filterStore * nextFeedback;
    idx = idx + 1 >= size ? 0 : idx + 1;
    out[i] = y;
  }
  return out;
}

function allpass(input: Float32Array, size: number, feedback: number): Float32Array {
  const buf = new Float32Array(size);
  const out = new Float32Array(input.length);
  let idx = 0;
  for (let i = 0; i < input.length; i++) {
    const bufout = buf[idx];
    out[i] = -input[i] + bufout;
    buf[idx] = input[i] + bufout * feedback;
    idx = idx + 1 >= size ? 0 : idx + 1;
  }
  return out;
}

function processChannel(input: Float32Array, sr: number, room: number | Float64Array, damp: number | Float64Array, spread: number): Float32Array {
  const scale = sr / 44100;
  const n = input.length;
  const fed = new Float32Array(n);
  for (let i = 0; i < n; i++) fed[i] = input[i] * FIXED_GAIN;
  const acc = new Float32Array(n);
  for (let c = 0; c < COMB_TUNING.length; c++) {
    const size = Math.round((COMB_TUNING[c] + spread) * scale);
    const combOut = comb(fed, size, room, damp);
    for (let i = 0; i < n; i++) acc[i] += combOut[i];
  }
  let chain: Float32Array = acc;
  for (let a = 0; a < ALLPASS_TUNING.length; a++) {
    const size = Math.round((ALLPASS_TUNING[a] + spread) * scale);
    chain = allpass(chain, size, 0.5);
  }
  return chain;
}

/** Stereo Freeverb. Mono input is up-mixed first; output is always stereo. */
export function reverb(d: AudioData, opts: ReverbOptions = {}): AudioData {
  const roomSize = Math.min(1, Math.max(0, opts.roomSize ?? 0.5));
  const damping = Math.min(1, Math.max(0, opts.damping ?? 0.5));
  const wet = opts.wet ?? 0.3;
  const dry = opts.dry ?? 0.7;
  const room = roomSize * 0.28 + 0.7;
  const damp = damping * 0.4;
  const sr = d.sampleRate;

  const stereo = setChannelCount(d, 2);
  const n = frameCount(stereo);
  const tail = Math.round((opts.tailSeconds ?? 2) * sr);
  // dry inputs, zero-padded with the reverb tail
  const inL = new Float32Array(n + tail);
  const inR = new Float32Array(n + tail);
  inL.set(stereo.channels[0]);
  inR.set(stereo.channels[1]);

  const automation = opts.automation;
  const offset = automation?.offsetSeconds ?? 0;
  const roomAutomation = automation?.roomSize;
  const dampAutomation = automation?.damping;
  const roomValues = roomAutomation ? new Float64Array(n + tail) : undefined;
  const dampValues = dampAutomation ? new Float64Array(n + tail) : undefined;
  if (roomValues || dampValues) {
    for (let i = 0; i < n + tail; i++) {
      const time = offset + i / sr;
      if (roomValues) {
        const nextRoomSize = Math.min(1, Math.max(0, roomAutomation?.(time, roomSize) ?? roomSize));
        roomValues[i] = nextRoomSize * 0.28 + 0.7;
      }
      if (dampValues) {
        const nextDamping = Math.min(1, Math.max(0, dampAutomation?.(time, damping) ?? damping));
        dampValues[i] = nextDamping * 0.4;
      }
    }
  }

  const wetL = processChannel(inL, sr, roomValues ?? room, dampValues ?? damp, 0);
  const wetR = processChannel(inR, sr, roomValues ?? room, dampValues ?? damp, STEREO_SPREAD);

  const out: AudioData = { sampleRate: sr, channels: [new Float32Array(n + tail), new Float32Array(n + tail)] };
  for (let i = 0; i < n + tail; i++) {
    out.channels[0][i] = inL[i] * dry + wetL[i] * wet;
    out.channels[1][i] = inR[i] * dry + wetR[i] * wet;
  }
  return out;
}
