// ─────────────────────────────────────────────────────────────
// engine/dsp/channel-mixer.test — Audition-style Channel Mixer
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { createAudioData } from "../audio/buffer";
import { channelCount, frameCount, type AudioData } from "../audio/types";
import { sine } from "../generate/tone";
import { channelMixer } from "./channel-mixer";

const SR = 44100;

/** Distinct stereo test signal (different tones per channel). */
function stereoPair(): AudioData {
  const l = sine(300, 0.05, { sampleRate: SR, amplitude: 0.5 }).channels[0];
  const r = sine(900, 0.05, { sampleRate: SR, amplitude: 0.4 }).channels[0];
  return { sampleRate: SR, channels: [l, r] };
}

function maxAbsDiff(a: Float32Array, b: Float32Array): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

describe("channelMixer", () => {
  it("identity leaves the signal unchanged", () => {
    const s = stereoPair();
    const out = channelMixer(s, {});
    expect(maxAbsDiff(out.channels[0], s.channels[0])).toBeLessThan(1e-7);
    expect(maxAbsDiff(out.channels[1], s.channels[1])).toBeLessThan(1e-7);
  });

  it("swaps L and R", () => {
    const s = stereoPair();
    const out = channelMixer(s, { leftToLeft: 0, rightToLeft: 100, leftToRight: 100, rightToRight: 0 });
    expect(maxAbsDiff(out.channels[0], s.channels[1])).toBeLessThan(1e-7);
    expect(maxAbsDiff(out.channels[1], s.channels[0])).toBeLessThan(1e-7);
  });

  it("sums to mono (both channels = (L+R)/2)", () => {
    const s = stereoPair();
    const out = channelMixer(s, { leftToLeft: 50, rightToLeft: 50, leftToRight: 50, rightToRight: 50 });
    for (let i = 0; i < frameCount(s); i++) {
      const expected = (s.channels[0][i] + s.channels[1][i]) / 2;
      expect(out.channels[0][i]).toBeCloseTo(expected, 6);
      expect(out.channels[1][i]).toBeCloseTo(out.channels[0][i], 6);
    }
  });

  it("routes left to both outputs", () => {
    const s = stereoPair();
    const out = channelMixer(s, { leftToLeft: 100, rightToLeft: 0, leftToRight: 100, rightToRight: 0 });
    expect(maxAbsDiff(out.channels[0], s.channels[0])).toBeLessThan(1e-7);
    expect(maxAbsDiff(out.channels[1], s.channels[0])).toBeLessThan(1e-7);
  });

  it("routes right to both outputs", () => {
    const s = stereoPair();
    const out = channelMixer(s, { leftToLeft: 0, rightToLeft: 100, leftToRight: 0, rightToRight: 100 });
    expect(maxAbsDiff(out.channels[0], s.channels[1])).toBeLessThan(1e-7);
    expect(maxAbsDiff(out.channels[1], s.channels[1])).toBeLessThan(1e-7);
  });

  it("inverts a channel's polarity", () => {
    const s = stereoPair();
    const out = channelMixer(s, { leftToLeft: 100, rightToLeft: 0, leftToRight: 0, rightToRight: -100 });
    for (let i = 0; i < frameCount(s); i++) expect(out.channels[1][i]).toBeCloseTo(-s.channels[1][i], 6);
    expect(maxAbsDiff(out.channels[0], s.channels[0])).toBeLessThan(1e-7);
  });

  it("Mid/Side encode then decode round-trips to the original", () => {
    const s = stereoPair();
    const ms = channelMixer(s, { leftToLeft: 50, rightToLeft: 50, leftToRight: 50, rightToRight: -50 });
    const back = channelMixer(ms, { leftToLeft: 100, rightToLeft: 100, leftToRight: 100, rightToRight: -100 });
    expect(maxAbsDiff(back.channels[0], s.channels[0])).toBeLessThan(1e-6);
    expect(maxAbsDiff(back.channels[1], s.channels[1])).toBeLessThan(1e-6);
  });

  it("up-mixes mono (identity → both channels equal the mono signal)", () => {
    const mono = sine(440, 0.05, { sampleRate: SR, amplitude: 0.5, channels: 1 });
    const out = channelMixer(mono, {});
    expect(channelCount(out)).toBe(2);
    expect(maxAbsDiff(out.channels[0], mono.channels[0])).toBeLessThan(1e-7);
    expect(maxAbsDiff(out.channels[1], mono.channels[0])).toBeLessThan(1e-7);
  });

  it("preserves frame count and is deterministic", () => {
    const s = stereoPair();
    const a = channelMixer(s, { leftToLeft: 70, rightToLeft: 30, leftToRight: 30, rightToRight: 70 });
    const b = channelMixer(s, { leftToLeft: 70, rightToLeft: 30, leftToRight: 30, rightToRight: 70 });
    expect(frameCount(a)).toBe(frameCount(s));
    expect(Array.from(a.channels[0])).toEqual(Array.from(b.channels[0]));
  });

  it("does not mutate its input", () => {
    const s = stereoPair();
    const copy = Array.from(s.channels[0]);
    channelMixer(s, { leftToLeft: 0, rightToLeft: 100, leftToRight: 100, rightToRight: 0 });
    expect(Array.from(s.channels[0])).toEqual(copy);
  });

  it("handles an empty buffer", () => {
    const out = channelMixer(createAudioData(2, 0, SR), { leftToLeft: 50, rightToLeft: 50 });
    expect(channelCount(out)).toBe(2);
    expect(frameCount(out)).toBe(0);
  });
});
