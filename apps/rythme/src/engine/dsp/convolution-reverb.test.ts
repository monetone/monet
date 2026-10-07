// ─────────────────────────────────────────────────────────────
// engine/dsp/convolution-reverb.test — Audition-style Convolution Reverb
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { createAudioData, fromChannels } from "../audio/buffer";
import { channelCount, frameCount } from "../audio/types";
import { sine } from "../generate/tone";
import { convolutionReverb, impulseResponseFromAudioData } from "./convolution-reverb";

const SR = 44100;

/** RMS of a channel over [start, end). */
function rmsRange(ch: Float32Array, start: number, end: number): number {
  let sum = 0;
  for (let i = start; i < end; i++) sum += ch[i] * ch[i];
  return Math.sqrt(sum / Math.max(1, end - start));
}

describe("convolutionReverb", () => {
  it("builds a mono, energy-normalized impulse response from imported audio", () => {
    const irAudio = fromChannels([[1, 0, 0], [0, 1, 0]], SR);
    const impulse = impulseResponseFromAudioData(irAudio);
    expect(impulse[0]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(impulse[1]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(impulse[2]).toBe(0);
  });

  it("can preserve imported impulse level when requested", () => {
    const irAudio = fromChannels([[0.25, -0.5]], SR);
    const impulse = impulseResponseFromAudioData(irAudio, { normalize: "none" });
    expect(Array.from(impulse)).toEqual([0.25, -0.5]);
  });

  it("convolving a delta with a custom impulse reproduces the impulse", () => {
    const delta = fromChannels([[1, 0, 0, 0]], SR);
    const out = convolutionReverb(delta, { impulse: Float32Array.from([1, 0.5, 0.25]), mix: 1 });
    expect(frameCount(out)).toBe(4 + 3 - 1);
    expect(out.channels[0][0]).toBeCloseTo(1, 6);
    expect(out.channels[0][1]).toBeCloseTo(0.5, 6);
    expect(out.channels[0][2]).toBeCloseTo(0.25, 6);
  });

  it("adds a reverb tail beyond the end of the input", () => {
    const tone = sine(440, 0.05, { sampleRate: SR, amplitude: 0.6 });
    const n = frameCount(tone);
    const out = convolutionReverb(tone, { decaySeconds: 0.2, mix: 0.5 });
    expect(frameCount(out)).toBeGreaterThan(n); // tail rings out past the input
    expect(rmsRange(out.channels[0], n + 100, frameCount(out))).toBeGreaterThan(1e-4); // tail carries energy
  });

  it("mix=0 is a dry pass-through (input then a silent tail)", () => {
    const tone = sine(440, 0.05, { sampleRate: SR, amplitude: 0.6 });
    const n = frameCount(tone);
    const out = convolutionReverb(tone, { decaySeconds: 0.2, mix: 0 });
    let maxErr = 0;
    for (let i = 0; i < n; i++) maxErr = Math.max(maxErr, Math.abs(out.channels[0][i] - tone.channels[0][i]));
    expect(maxErr).toBeLessThan(1e-6);
    expect(rmsRange(out.channels[0], n, frameCount(out))).toBeLessThan(1e-6); // tail is silent
  });

  it("a longer decay produces a longer output", () => {
    const tone = sine(440, 0.05, { sampleRate: SR, amplitude: 0.6 });
    const short = convolutionReverb(tone, { decaySeconds: 0.2, mix: 0.5 });
    const long = convolutionReverb(tone, { decaySeconds: 0.4, mix: 0.5 });
    expect(frameCount(long)).toBeGreaterThan(frameCount(short));
  });

  it("is deterministic for a fixed seed and varies with the seed", () => {
    const tone = sine(440, 0.03, { sampleRate: SR, amplitude: 0.6 });
    const a = convolutionReverb(tone, { decaySeconds: 0.1, mix: 0.5, seed: 7 });
    const b = convolutionReverb(tone, { decaySeconds: 0.1, mix: 0.5, seed: 7 });
    const c = convolutionReverb(tone, { decaySeconds: 0.1, mix: 0.5, seed: 8 });
    expect(Array.from(a.channels[0])).toEqual(Array.from(b.channels[0]));
    let diff = 0;
    for (let i = 0; i < a.channels[0].length; i++) diff = Math.max(diff, Math.abs(a.channels[0][i] - c.channels[0][i]));
    expect(diff).toBeGreaterThan(1e-4);
  });

  it("preserves channel count (stereo)", () => {
    const tone = sine(440, 0.03, { sampleRate: SR, amplitude: 0.5, channels: 2 });
    const out = convolutionReverb(tone, { decaySeconds: 0.1, mix: 0.4 });
    expect(channelCount(out)).toBe(2);
    expect(out.channels[0].length).toBe(out.channels[1].length);
  });

  it("does not mutate its input", () => {
    const tone = sine(440, 0.03, { sampleRate: SR, amplitude: 0.6 });
    const copy = Array.from(tone.channels[0]);
    convolutionReverb(tone, { decaySeconds: 0.15, mix: 0.5 });
    expect(Array.from(tone.channels[0])).toEqual(copy);
  });

  it("handles an empty buffer", () => {
    const out = convolutionReverb(createAudioData(2, 0, SR), { decaySeconds: 0.2 });
    expect(channelCount(out)).toBe(2);
    expect(frameCount(out)).toBe(0);
  });
});
