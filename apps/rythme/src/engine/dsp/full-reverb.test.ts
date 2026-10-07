// ─────────────────────────────────────────────────────────────
// engine/dsp/full-reverb.test — Audition-style Full Reverb
// ─────────────────────────────────────────────────────────────
// Verifies the convolution reverb's behaviour: it appends a decaying tail whose
// length tracks Decay Time, the Coloration EQ darkens the tail, Perception
// changes the early-reflection pattern, and mix=0 is a clean dry passthrough.

import { describe, expect, it } from "vitest";
import { createAudioData } from "../audio/buffer";
import { frameCount, type AudioData } from "../audio/types";
import { whiteNoise } from "../generate/noise";
import { highpass } from "./filter";
import { fullReverb } from "./full-reverb";

const SR = 44100;

const src = (seconds = 0.12, seed = 7) => whiteNoise(seconds, { sampleRate: SR, amplitude: 0.5, seed, channels: 1 });

function impulseAt(seconds: number, totalSeconds = 0.18): AudioData {
  const out = createAudioData(1, Math.round(totalSeconds * SR), SR);
  out.channels[0][Math.round(seconds * SR)] = 1;
  return out;
}

function rms(ch: Float32Array, a = 0, b = ch.length): number {
  let s = 0;
  for (let i = a; i < b; i++) s += ch[i] * ch[i];
  return Math.sqrt(s / Math.max(1, b - a));
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

describe("fullReverb — tail", () => {
  it("appends a decaying reverb tail with real energy", () => {
    const s = src();
    const n = frameCount(s);
    const out = fullReverb(s, { decayMs: 250, mix: 0.5 });
    expect(frameCount(out)).toBeGreaterThan(n);
    expect(rms(out.channels[0], n, out.channels[0].length)).toBeGreaterThan(1e-3);
  });

  it("makes a longer tail for a longer Decay Time", () => {
    const s = src();
    const shortLen = frameCount(fullReverb(s, { decayMs: 150, mix: 0.5 }));
    const longLen = frameCount(fullReverb(s, { decayMs: 500, mix: 0.5 }));
    expect(longLen).toBeGreaterThan(shortLen);
  });

  it("output length equals input + IR − 1 (convolution length)", () => {
    const s = src();
    const decayN = Math.round((300 / 1000) * SR);
    const out = fullReverb(s, { decayMs: 300, preDelayMs: 0, mix: 0.5 });
    expect(frameCount(out)).toBe(frameCount(s) + decayN - 1);
  });

  it("clamps absurd decay times to the supported range", () => {
    const s = src(0.02); // tiny input keeps the 6 s-IR convolution fast
    const out = fullReverb(s, { decayMs: 999999, mix: 0.5 });
    // 6 s ceiling → IR ≤ 6·SR; output length is bounded accordingly.
    expect(frameCount(out)).toBeLessThanOrEqual(frameCount(s) + 6 * SR);
    for (const v of out.channels[0]) expect(Number.isFinite(v)).toBe(true);
  });
});

describe("fullReverb — coloration", () => {
  it("a high-cut Coloration shelf darkens the tail (less HF energy)", () => {
    const s = src();
    const n = frameCount(s);
    const flat = fullReverb(s, { decayMs: 300, mix: 1, coloration: {} });
    const dark = fullReverb(s, { decayMs: 300, mix: 1, coloration: { highDb: -18, highFreq: 4000 } });
    const hfFlat = rms(highpass(flat, 4000).channels[0], n, flat.channels[0].length);
    const hfDark = rms(highpass(dark, 4000).channels[0], n, dark.channels[0].length);
    expect(hfDark).toBeLessThan(hfFlat * 0.7);
  });

  it("the default coloration applies a gentle absorption (changes the tail)", () => {
    const s = src();
    const def = fullReverb(s, { decayMs: 300, mix: 1 });
    const flat = fullReverb(s, { decayMs: 300, mix: 1, coloration: {} });
    expect(maxAbsDiff(def.channels[0], flat.channels[0])).toBeGreaterThan(1e-4);
  });
});

describe("fullReverb — perception", () => {
  it("changes the early-reflection pattern with the Perception setting", () => {
    const s = src();
    const lo = fullReverb(s, { decayMs: 300, perception: 5, mix: 1, seed: 3 }).channels[0];
    const hi = fullReverb(s, { decayMs: 300, perception: 95, mix: 1, seed: 3 }).channels[0];
    expect(maxAbsDiff(lo, hi)).toBeGreaterThan(1e-3);
  });
});

describe("fullReverb — mix & robustness", () => {
  it("mix=0 leaves the dry signal untouched (and a silent tail)", () => {
    const s = src();
    const n = frameCount(s);
    const out = fullReverb(s, { decayMs: 300, mix: 0 });
    for (let i = 0; i < n; i++) expect(out.channels[0][i]).toBeCloseTo(s.channels[0][i], 6);
    expect(rms(out.channels[0], n, out.channels[0].length)).toBeLessThan(1e-6);
  });

  it("automates mix per sample after the convolution response", () => {
    const s = src(0.24, 13);
    const opts = { decayMs: 40, perception: 40, preDelayMs: 0, absorption: 0.2, mix: 0, seed: 5 };
    const out = fullReverb(s, {
      ...opts,
      automation: {
        mix: (time, fallback) => (time < 0.12 ? fallback : 1),
      },
    });
    const dry = fullReverb(s, opts);
    const wet = fullReverb(s, { ...opts, mix: 1 });

    expect(segmentMeanAbsDiff(out, dry, 0.04, 0.1)).toBeLessThan(1e-6);
    expect(segmentMeanAbsDiff(out, wet, 0.15, 0.22)).toBeLessThan(1e-6);
    expect(segmentMeanAbsDiff(dry, wet, 0.15, 0.22)).toBeGreaterThan(0.01);
  });

  it("automates decay, perception, absorption, and coloration by source time", () => {
    const input = impulseAt(0.12);
    const low = { decayMs: 40, perception: 5, preDelayMs: 0, absorption: 0.05, coloration: { highDb: 0, highFreq: 6000 }, mix: 1, seed: 3 };
    const high = { ...low, decayMs: 160, perception: 95, absorption: 0.8, coloration: { highDb: -18, highFreq: 4000 } };
    const out = fullReverb(input, {
      ...low,
      automation: {
        decayMs: (time, fallback) => (time < 0.1 ? fallback : high.decayMs),
        perception: (time, fallback) => (time < 0.1 ? fallback : high.perception),
        absorption: (time, fallback) => (time < 0.1 ? fallback : high.absorption),
        colorHighDb: (time, fallback) => (time < 0.1 ? fallback : high.coloration.highDb),
        colorHighFreq: (time, fallback) => (time < 0.1 ? fallback : high.coloration.highFreq),
      },
    });
    const lowOut = fullReverb(input, low);
    const highOut = fullReverb(input, high);

    expect(frameCount(out)).toBeGreaterThan(frameCount(lowOut));
    expect(frameCount(out)).toBeLessThanOrEqual(frameCount(highOut));
    expect(segmentMeanAbsDiff(out, highOut, 0.13, 0.25)).toBeLessThan(1e-6);
    expect(segmentMeanAbsDiff(lowOut, highOut, 0.13, 0.2)).toBeGreaterThan(0.001);
  });

  it("processes every channel of a stereo buffer", () => {
    const l = whiteNoise(0.1, { sampleRate: SR, amplitude: 0.5, seed: 1, channels: 1 }).channels[0];
    const r = whiteNoise(0.1, { sampleRate: SR, amplitude: 0.5, seed: 2, channels: 1 }).channels[0];
    const stereo: AudioData = { sampleRate: SR, channels: [Float32Array.from(l), Float32Array.from(r)] };
    const n = stereo.channels[0].length;
    const out = fullReverb(stereo, { decayMs: 250, mix: 0.5 });
    expect(out.channels.length).toBe(2);
    expect(rms(out.channels[0], n, out.channels[0].length)).toBeGreaterThan(1e-3);
    expect(rms(out.channels[1], n, out.channels[1].length)).toBeGreaterThan(1e-3);
  });

  it("does not mutate the input", () => {
    const s = src();
    const snapshot = Float32Array.from(s.channels[0]);
    fullReverb(s, { decayMs: 300, perception: 60, mix: 0.6 });
    expect(maxAbsDiff(s.channels[0], snapshot)).toBe(0);
  });

  it("is deterministic for a fixed seed", () => {
    const s = src();
    const a = fullReverb(s, { decayMs: 300, perception: 50, mix: 0.5, seed: 9 });
    const b = fullReverb(s, { decayMs: 300, perception: 50, mix: 0.5, seed: 9 });
    expect(maxAbsDiff(a.channels[0], b.channels[0])).toBe(0);
  });

  it("handles an empty buffer", () => {
    const empty = createAudioData(1, 0, SR);
    const out = fullReverb(empty, { decayMs: 300 });
    expect(frameCount(out)).toBe(0);
  });
});
