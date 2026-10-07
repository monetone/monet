// ─────────────────────────────────────────────────────────────
// engine/dsp/studio-reverb.test — Audition-style Studio Reverb
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { createAudioData } from "../audio/buffer";
import { frameCount, type AudioData } from "../audio/types";
import { sine } from "../generate/tone";
import * as DSP from "./index";
import { earlyReflections, studioReverb } from "./studio-reverb";

const SR = 44100;

describe("dsp barrel", () => {
  it("re-exports studioReverb and earlyReflections", () => {
    expect(typeof DSP.studioReverb).toBe("function");
    expect(typeof DSP.earlyReflections).toBe("function");
  });
});

/** A stereo unit impulse: 1 at sample 0, silence after, `n` frames total. */
function impulse(n = 8192): AudioData {
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  l[0] = 1;
  r[0] = 1;
  return { sampleRate: SR, channels: [l, r] };
}

/** Energy (sum of squares) over a sample range. */
function energy(ch: Float32Array, from: number, to: number): number {
  let s = 0;
  for (let i = from; i < Math.min(to, ch.length); i++) s += ch[i] * ch[i];
  return s;
}

function maxAbsDiff(a: Float32Array, b: Float32Array): number {
  let m = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

function segmentMeanAbsDiff(a: AudioData, b: AudioData, startSeconds: number, endSeconds: number): number {
  const start = Math.max(0, Math.round(startSeconds * a.sampleRate));
  const end = Math.min(frameCount(a), frameCount(b), Math.round(endSeconds * a.sampleRate));
  let sum = 0;
  let count = 0;
  const channels = Math.min(a.channels.length, b.channels.length);
  for (let c = 0; c < channels; c++) {
    for (let i = start; i < end; i++) {
      sum += Math.abs(a.channels[c][i] - b.channels[c][i]);
      count++;
    }
  }
  return count > 0 ? sum / count : 0;
}

function impulseAt(seconds: number, totalSeconds = 0.8): AudioData {
  const d = createAudioData(2, Math.round(totalSeconds * SR), SR);
  const i = Math.round(seconds * SR);
  d.channels[0][i] = 1;
  d.channels[1][i] = 1;
  return d;
}

const ER_TAPS = [
  { t: 0.1, g: 0.9 },
  { t: 0.21, g: 0.72 },
  { t: 0.34, g: 0.6 },
  { t: 0.49, g: 0.5 },
  { t: 0.66, g: 0.42 },
  { t: 0.82, g: 0.33 },
  { t: 1.0, g: 0.26 },
];

describe("earlyReflections", () => {
  it("places the tap gains exactly at the tap delays for an impulse", () => {
    const earlyMs = 80;
    const out = earlyReflections(impulse(), { earlyMs, level: 1, width: 0 });
    const base = (earlyMs / 1000) * SR;
    for (const tap of ER_TAPS) {
      const delay = Math.round(tap.t * base);
      expect(out.channels[0][delay]).toBeCloseTo(tap.g, 6);
    }
    // Between the first two taps the response is silent.
    const between = Math.round(((ER_TAPS[0].t + ER_TAPS[1].t) / 2) * base);
    expect(Math.abs(out.channels[0][between])).toBeLessThan(1e-6);
  });

  it("scales the reflections by level", () => {
    const a = earlyReflections(impulse(), { earlyMs: 80, level: 1, width: 0 });
    const b = earlyReflections(impulse(), { earlyMs: 80, level: 0.5, width: 0 });
    const delay = Math.round(ER_TAPS[0].t * (80 / 1000) * SR);
    expect(b.channels[0][delay]).toBeCloseTo(a.channels[0][delay] * 0.5, 6);
  });

  it("decorrelates the channels with width (and matches them at width 0)", () => {
    const mono = earlyReflections(impulse(), { earlyMs: 80, width: 0 });
    expect(maxAbsDiff(mono.channels[0], mono.channels[1])).toBeLessThan(1e-7);
    const wide = earlyReflections(impulse(), { earlyMs: 80, width: 0.9 });
    expect(maxAbsDiff(wide.channels[0], wide.channels[1])).toBeGreaterThan(0.1);
  });

  it("does not mutate the input", () => {
    const s = impulse();
    const snap = Float32Array.from(s.channels[0]);
    earlyReflections(s, { earlyMs: 80 });
    expect(maxAbsDiff(s.channels[0], snap)).toBe(0);
  });
});

describe("studioReverb", () => {
  it("adds a decaying tail after an impulse", () => {
    const n = 4096;
    const out = studioReverb(impulse(n), { decay: 0.6, mix: 1, tailSeconds: 1 });
    // The tail rings out well past the dry impulse, and later windows are quieter.
    const early = energy(out.channels[0], n, n + SR / 4);
    const late = energy(out.channels[0], n + SR / 2, n + (3 * SR) / 4);
    expect(early).toBeGreaterThan(0);
    expect(late).toBeLessThan(early);
  });

  it("a longer decay yields more tail energy", () => {
    const n = 4096;
    const shortD = studioReverb(impulse(n), { decay: 0.2, mix: 1, tailSeconds: 1.5 });
    const longD = studioReverb(impulse(n), { decay: 0.9, mix: 1, tailSeconds: 1.5 });
    const win = (d: AudioData) => energy(d.channels[0], n + SR / 2, n + SR);
    expect(win(longD)).toBeGreaterThan(win(shortD));
  });

  it("leaves the dry untouched with a silent tail at mix 0", () => {
    const n = 4096;
    const s = impulse(n);
    const out = studioReverb(s, { mix: 0, tailSeconds: 0.5 });
    // First n samples equal the dry input…
    for (let i = 0; i < n; i++) expect(out.channels[0][i]).toBeCloseTo(s.channels[0][i], 6);
    // …and the appended tail is silent.
    expect(energy(out.channels[0], n, out.channels[0].length)).toBeLessThan(1e-9);
  });

  it("automates mix per sample across the dry/wet blend", () => {
    const s = sine(440, 1, { sampleRate: SR, amplitude: 0.35, channels: 2 });
    const opts = { decay: 0.5, damping: 0.4, earlyMs: 60, earlyLevel: 0.5, mix: 0, tailSeconds: 0.2 };
    const out = studioReverb(s, {
      ...opts,
      automation: {
        mix: (time, fallback) => (time < 0.5 ? fallback : 1),
      },
    });
    const dry = studioReverb(s, opts);
    const wet = studioReverb(s, { ...opts, mix: 1 });

    expect(segmentMeanAbsDiff(out, dry, 0.1, 0.45)).toBeLessThan(1e-6);
    expect(segmentMeanAbsDiff(out, wet, 0.65, 0.95)).toBeLessThan(1e-6);
    expect(segmentMeanAbsDiff(dry, wet, 0.65, 0.95)).toBeGreaterThan(0.001);
  });

  it("automates early reflection level independently of the late tail", () => {
    const earlyMs = 80;
    const out = studioReverb(impulse(), {
      decay: 0.5,
      damping: 0.4,
      earlyMs,
      earlyLevel: 0,
      width: 0,
      mix: 1,
      tailSeconds: 0.2,
      automation: {
        earlyLevel: (time, fallback) => (time < 0.05 ? fallback : 1),
      },
    });
    const low = studioReverb(impulse(), { decay: 0.5, damping: 0.4, earlyMs, earlyLevel: 0, width: 0, mix: 1, tailSeconds: 0.2 });
    const high = studioReverb(impulse(), { decay: 0.5, damping: 0.4, earlyMs, earlyLevel: 1, width: 0, mix: 1, tailSeconds: 0.2 });
    const latestTap = Math.round(earlyMs * 0.001 * SR);

    expect(out.channels[0][latestTap]).toBeCloseTo(high.channels[0][latestTap], 6);
    expect(Math.abs(high.channels[0][latestTap] - low.channels[0][latestTap])).toBeGreaterThan(0.2);
  });

  it("automates decay and damping inside the late reverb tail", () => {
    const input = impulseAt(0.55, 0.75);
    const low = { decay: 0.1, damping: 0, earlyMs: 60, earlyLevel: 0, width: 0, mix: 1, tailSeconds: 0.5 };
    const high = { ...low, decay: 0.9, damping: 1 };
    const out = studioReverb(input, {
      ...low,
      automation: {
        decay: (time, fallback) => (time < 0.5 ? fallback : high.decay),
        damping: (time, fallback) => (time < 0.5 ? fallback : high.damping),
      },
    });
    const lowOut = studioReverb(input, low);
    const highOut = studioReverb(input, high);

    expect(segmentMeanAbsDiff(out, highOut, 0.65, 0.95)).toBeLessThan(1e-6);
    expect(segmentMeanAbsDiff(lowOut, highOut, 0.65, 0.95)).toBeGreaterThan(0.0001);
  });

  it("automates width in the early-reflection pattern", () => {
    const input = impulseAt(0.55, 0.75);
    const low = { decay: 0.1, damping: 0.4, earlyMs: 80, earlyLevel: 1, width: 0, mix: 1, tailSeconds: 0.2 };
    const high = { ...low, width: 0.9 };
    const out = studioReverb(input, {
      ...low,
      automation: {
        width: (time, fallback) => (time < 0.5 ? fallback : high.width),
      },
    });
    const lowOut = studioReverb(input, low);
    const highOut = studioReverb(input, high);

    expect(segmentMeanAbsDiff(out, highOut, 0.57, 0.68)).toBeLessThan(1e-6);
    expect(segmentMeanAbsDiff(lowOut, highOut, 0.57, 0.68)).toBeGreaterThan(0.0001);
  });

  it("extends the output by the tail and is deterministic", () => {
    const n = 4096;
    const s = sine(440, n / SR, { sampleRate: SR, amplitude: 0.4, channels: 2 });
    const a = studioReverb(s, { tailSeconds: 1 });
    const b = studioReverb(s, { tailSeconds: 1 });
    expect(frameCount(a)).toBe(n + Math.round(1 * SR));
    expect(maxAbsDiff(a.channels[0], b.channels[0])).toBe(0);
  });

  it("does not mutate the input", () => {
    const s = sine(440, 0.1, { sampleRate: SR, amplitude: 0.4, channels: 2 });
    const snap = Float32Array.from(s.channels[0]);
    studioReverb(s, { mix: 0.5 });
    expect(maxAbsDiff(s.channels[0], snap)).toBe(0);
  });

  it("handles an empty buffer", () => {
    const empty = createAudioData(2, 0, SR);
    const out = studioReverb(empty, { tailSeconds: 0.2 });
    expect(frameCount(out)).toBe(Math.round(0.2 * SR));
  });
});
