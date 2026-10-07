// ─────────────────────────────────────────────────────────────
// engine/dsp/notch-filter.test — Audition-style Notch Filter
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { createAudioData } from "../audio/buffer";
import { frameCount, type AudioData } from "../audio/types";
import { sine } from "../generate/tone";
import { notchFilter, notchResponseDb } from "./notch-filter";

const SR = 44100;

const tone = (freq: number, amp = 0.5) => sine(freq, 0.2, { sampleRate: SR, amplitude: amp });

/** RMS over the settled (second-half) region, past the IIR ramp-up. */
function settledRms(ch: Float32Array): number {
  let sum = 0;
  const start = ch.length >> 1;
  for (let i = start; i < ch.length; i++) sum += ch[i] * ch[i];
  return Math.sqrt(sum / (ch.length - start));
}

function maxAbsDiff(a: Float32Array, b: Float32Array): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

/** Linear amplitude ratio → dB. */
function gain(ratio: number): number {
  return 20 * Math.log10(ratio);
}

describe("notchResponseDb", () => {
  it("equals a notch's gainDb at its own center frequency", () => {
    const opts = { notches: [{ frequency: 1000, gainDb: -30 }], q: 30 };
    expect(notchResponseDb(opts, 1000, SR)).toBeCloseTo(-30, 3);
  });

  it("is approximately flat (0 dB) far from any notch", () => {
    const opts = { notches: [{ frequency: 1000, gainDb: -40 }], q: 30 };
    // Two octaves away the narrow notch barely reaches.
    expect(notchResponseDb(opts, 250, SR)).toBeGreaterThan(-1);
    expect(notchResponseDb(opts, 4000, SR)).toBeGreaterThan(-1);
  });

  it("reaches each notch's depth at its own center for independent notches", () => {
    const opts = { notches: [{ frequency: 300, gainDb: -30 }, { frequency: 3000, gainDb: -24 }], q: 40 };
    // Leakage from the far notch is tiny, so each center is within ~1 dB of its depth.
    expect(notchResponseDb(opts, 300, SR)).toBeLessThan(-29);
    expect(notchResponseDb(opts, 300, SR)).toBeGreaterThan(-31);
    expect(notchResponseDb(opts, 3000, SR)).toBeLessThan(-23);
    expect(notchResponseDb(opts, 3000, SR)).toBeGreaterThan(-25);
  });

  it("returns 0 dB with no notches", () => {
    expect(notchResponseDb({ notches: [] }, 1000, SR)).toBe(0);
  });
});

describe("notchFilter", () => {
  it("attenuates a steady tone at the notch frequency", () => {
    const t = tone(1000);
    const out = notchFilter(t, { notches: [{ frequency: 1000, gainDb: -30 }], q: 30 });
    const ratioDb = gain(settledRms(out.channels[0]) / settledRms(t.channels[0]));
    expect(ratioDb).toBeLessThan(-25);
    expect(ratioDb).toBeGreaterThan(-35);
  });

  it("leaves a tone far from every notch essentially unchanged", () => {
    const t = tone(4000);
    const out = notchFilter(t, { notches: [{ frequency: 1000, gainDb: -40 }], q: 30 });
    const ratioDb = gain(settledRms(out.channels[0]) / settledRms(t.channels[0]));
    expect(ratioDb).toBeGreaterThan(-1);
  });

  it("attenuates two independent tones with two notches", () => {
    const lo = tone(300).channels[0];
    const hi = tone(3000).channels[0];
    const mix = new Float32Array(lo.length);
    for (let i = 0; i < mix.length; i++) mix[i] = lo[i] + hi[i];
    const t: AudioData = { sampleRate: SR, channels: [mix] };
    const out = notchFilter(t, { notches: [{ frequency: 300, gainDb: -30 }, { frequency: 3000, gainDb: -30 }], q: 40 });
    expect(settledRms(out.channels[0])).toBeLessThan(settledRms(mix) * 0.5);
  });

  it("is an exact passthrough with no notches", () => {
    const t = tone(440);
    const out = notchFilter(t, { notches: [] });
    expect(maxAbsDiff(out.channels[0], t.channels[0])).toBeLessThan(1e-7);
  });

  it("preserves frame count and is deterministic", () => {
    const t = tone(1000);
    const a = notchFilter(t, { notches: [{ frequency: 1000 }] });
    const b = notchFilter(t, { notches: [{ frequency: 1000 }] });
    expect(frameCount(a)).toBe(frameCount(t));
    expect(maxAbsDiff(a.channels[0], b.channels[0])).toBe(0);
  });

  it("does not mutate the input", () => {
    const t = tone(1000);
    const snapshot = Float32Array.from(t.channels[0]);
    notchFilter(t, { notches: [{ frequency: 1000, gainDb: -40 }] });
    expect(maxAbsDiff(t.channels[0], snapshot)).toBe(0);
  });

  it("handles an empty buffer", () => {
    const empty = createAudioData(1, 0, SR);
    const out = notchFilter(empty, { notches: [{ frequency: 1000 }] });
    expect(frameCount(out)).toBe(0);
  });
});
