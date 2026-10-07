// ─────────────────────────────────────────────────────────────
// engine/dsp/dereverb.test — Audition-style DeReverb (tail suppression)
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { createAudioData } from "../audio/buffer";
import { frameCount, type AudioData } from "../audio/types";
import { whiteNoise } from "../generate/noise";
import { deReverb } from "./dereverb";

const SR = 44100;
const N = 16384;
const ONSET = 512; // a short, transient direct burst
const TAU = 0.06; // 60 ms reverb-tail decay
const TAIL_FROM = 4096; // window well inside the decaying tail

/** A direct onset burst followed by a decaying broadband tail (synthetic reverb). */
function reverberant(seed = 7): AudioData {
  const base = whiteNoise(N / SR, { sampleRate: SR, amplitude: 1, seed }).channels[0];
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const env = i < ONSET ? 1 : 0.7 * Math.exp(-(i - ONSET) / (TAU * SR));
    out[i] = base[i] * env;
  }
  return { sampleRate: SR, channels: [out] };
}

function rms(ch: Float32Array, from = 0, to = ch.length): number {
  let s = 0;
  for (let i = from; i < to; i++) s += ch[i] * ch[i];
  return Math.sqrt(s / Math.max(1, to - from));
}

function maxAbsDiff(a: Float32Array, b: Float32Array): number {
  let m = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

const tailRms = (ch: Float32Array) => rms(ch, TAIL_FROM, N);
const onsetRms = (ch: Float32Array) => rms(ch, 0, ONSET);

describe("deReverb", () => {
  it("reduces a decaying reverberant tail", () => {
    const dry = reverberant();
    const out = deReverb(dry, {});
    expect(tailRms(out.channels[0])).toBeLessThan(tailRms(dry.channels[0]) * 0.6);
  });

  it("preserves the direct onset relatively more than the tail", () => {
    const dry = reverberant();
    const out = deReverb(dry, {});
    const onsetRatio = onsetRms(out.channels[0]) / onsetRms(dry.channels[0]);
    const tailRatio = tailRms(out.channels[0]) / tailRms(dry.channels[0]);
    expect(onsetRatio).toBeGreaterThan(tailRatio * 1.2);
  });

  it("amount=0 reconstructs the input (WOLA STFT/ISTFT identity)", () => {
    const dry = reverberant();
    const out = deReverb(dry, { amount: 0 });
    expect(maxAbsDiff(out.channels[0], dry.channels[0])).toBeLessThan(1e-3);
  });

  it("removes more tail at a stronger amount", () => {
    const dry = reverberant();
    const gentle = tailRms(deReverb(dry, { amount: 0.3 }).channels[0]);
    const strong = tailRms(deReverb(dry, { amount: 1 }).channels[0]);
    expect(strong).toBeLessThan(gentle);
  });

  it("reduces the tail across the reverbMs range (short and long)", () => {
    const dry = reverberant();
    const before = tailRms(dry.channels[0]);
    expect(tailRms(deReverb(dry, { reverbMs: 50 }).channels[0])).toBeLessThan(before);
    expect(tailRms(deReverb(dry, { reverbMs: 1000 }).channels[0])).toBeLessThan(before);
  });

  it("throws on a non-power-of-two fftSize", () => {
    expect(() => deReverb(reverberant(), { fftSize: 3000 })).toThrow(/power of two/);
  });

  it("preserves frame count and is deterministic", () => {
    const dry = reverberant();
    const a = deReverb(dry, {});
    const b = deReverb(dry, {});
    expect(frameCount(a)).toBe(frameCount(dry));
    expect(maxAbsDiff(a.channels[0], b.channels[0])).toBe(0);
  });

  it("does not mutate the input", () => {
    const dry = reverberant();
    const snap = Float32Array.from(dry.channels[0]);
    deReverb(dry, { amount: 1 });
    expect(maxAbsDiff(dry.channels[0], snap)).toBe(0);
  });

  it("handles an empty buffer", () => {
    const out = deReverb(createAudioData(1, 0, SR), {});
    expect(frameCount(out)).toBe(0);
  });

  it("processes stereo independently without throwing", () => {
    const left = reverberant(1).channels[0];
    const right = reverberant(2).channels[0];
    const stereo: AudioData = { sampleRate: SR, channels: [left, right] };
    const out = deReverb(stereo, {});
    expect(out.channels.length).toBe(2);
    expect(tailRms(out.channels[0])).toBeLessThan(tailRms(left) * 0.6);
    expect(tailRms(out.channels[1])).toBeLessThan(tailRms(right) * 0.6);
  });
});
