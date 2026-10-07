// ─────────────────────────────────────────────────────────────
// engine/dsp/pitch-bend — Adobe Audition–style Pitch Bender
// ─────────────────────────────────────────────────────────────
// Tape-style pitch-over-time: it varies the playback RATE along a pitch
// envelope, so — unlike the duration-preserving Pitch Shifter — pitch and
// length move together (higher-pitch sections play faster/shorter, lower ones
// slower/longer, like a record changing speed). Implemented by walking a read
// position whose per-sample advance is 2^(semitones(progress)/12) and reading
// the source with linear interpolation. Pure `(AudioData, opts) => AudioData`;
// the input is never mutated.

import { cloneAudioData, createAudioData } from "../audio/buffer";
import { clamp } from "../audio/db";
import { channelCount, frameCount, type AudioData } from "../audio/types";

export interface PitchBendOptions {
  /** Pitch offset at the start of the clip, in semitones. */
  startSemitones?: number;
  /** Pitch offset at the end of the clip, in semitones (linear ramp from start). */
  endSemitones?: number;
  /** Optional pitch envelope (semitones) sampled across the clip; overrides the ramp. */
  envelope?: number[];
}

const SEMI_MIN = -24;
const SEMI_MAX = 24;

/** Linear-interpolated read of `ch` at fractional sample position `pos` (clamped). */
function readAt(ch: Float32Array, pos: number): number {
  if (pos <= 0) return ch[0];
  const last = ch.length - 1;
  if (pos >= last) return ch[last];
  const i0 = Math.floor(pos);
  const frac = pos - i0;
  return ch[i0] * (1 - frac) + ch[i0 + 1] * frac;
}

/** Semitone value at progress `p` ∈ [0,1] from an envelope or a start→end ramp. */
function semitonesAt(p: number, start: number, end: number, env: number[] | undefined): number {
  let s: number;
  if (env && env.length > 0) {
    if (env.length === 1) s = env[0];
    else {
      const x = clamp(p, 0, 1) * (env.length - 1);
      const i0 = Math.floor(x);
      const i1 = Math.min(env.length - 1, i0 + 1);
      s = env[i0] * (1 - (x - i0)) + env[i1] * (x - i0);
    }
  } else {
    s = start + (end - start) * p;
  }
  return clamp(s, SEMI_MIN, SEMI_MAX);
}

/**
 * Pitch-bend a buffer along a semitone ramp (or envelope), tape-style. The
 * output length changes with the bend (faster where higher, slower where
 * lower); channel count is preserved. `start=end=0` is an identity.
 */
export function pitchBend(d: AudioData, opts: PitchBendOptions = {}): AudioData {
  const n = frameCount(d);
  const ch = channelCount(d);
  if (n === 0 || ch === 0) return cloneAudioData(d);

  const start = clamp(opts.startSemitones ?? 0, SEMI_MIN, SEMI_MAX);
  const end = clamp(opts.endSemitones ?? 0, SEMI_MIN, SEMI_MAX);
  const env = opts.envelope;

  // Worst-case output length = input / slowest rate (lowest semitone reached).
  const minSemi = env && env.length ? Math.max(SEMI_MIN, env.reduce((a, b) => Math.min(a, b), Infinity)) : Math.min(start, end);
  const maxOut = Math.ceil(n / Math.pow(2, minSemi / 12)) + 2;
  const tmp: Float32Array[] = [];
  for (let c = 0; c < ch; c++) tmp.push(new Float32Array(maxOut));

  const span = n - 1;
  let pos = 0;
  let count = 0;
  while (pos < span && count < maxOut) {
    const p = span > 0 ? pos / span : 0;
    const rate = Math.pow(2, semitonesAt(p, start, end, env) / 12);
    for (let c = 0; c < ch; c++) tmp[c][count] = readAt(d.channels[c], pos);
    pos += rate;
    count++;
  }

  const out = createAudioData(ch, count, d.sampleRate);
  for (let c = 0; c < ch; c++) out.channels[c].set(tmp[c].subarray(0, count));
  return out;
}
