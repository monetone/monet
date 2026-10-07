// ─────────────────────────────────────────────────────────────
// engine/dsp/echo.test — Audition-style Echo (successive echo equalization)
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { createAudioData } from "../audio/buffer";
import { frameCount, type AudioData } from "../audio/types";
import { whiteNoise } from "../generate/noise";
import { highpass } from "./filter";
import { echo } from "./echo";

const SR = 44100;
const FLAT = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
// Aggressive high-cut (bands at 1k/2k/4k/8k/16k) so the darkening is unambiguous.
const HIGHCUT = [0, 0, 0, 0, 0, -12, -18, -24, -30, -36];

const impulse = (n: number): AudioData => {
  const a = new Float32Array(n);
  a[0] = 1;
  return { sampleRate: SR, channels: [a] };
};

const impulseAt = (seconds: number, totalSeconds = 0.8): AudioData => {
  const a = new Float32Array(Math.round(totalSeconds * SR));
  a[Math.round(seconds * SR)] = 1;
  return { sampleRate: SR, channels: [a] };
};

const burst = (seconds: number, seed: number, channels = 1) =>
  whiteNoise(seconds, { sampleRate: SR, amplitude: 0.8, seed, channels });

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

describe("echo", () => {
  it("flat EQ → clean multi-tap delay: repeats at D, 2D, 3D decaying by feedback", () => {
    const D = Math.round(0.01 * SR); // 10 ms → 441 samples
    const out = echo(impulse(8), { delayMs: 10, feedback: 0.5, mix: 1, eqGainsDb: FLAT, tailSeconds: 0.1 }).channels[0];
    expect(out[0]).toBeCloseTo(1, 5); // dry impulse
    expect(out[D]).toBeCloseTo(0.5, 3); // echo 1 = feedback^1
    expect(out[2 * D]).toBeCloseTo(0.25, 3); // echo 2 = feedback^2
    expect(out[3 * D]).toBeCloseTo(0.125, 3); // echo 3 = feedback^3
    expect(out[Math.round(D / 2)]).toBeCloseTo(0, 4); // silence between repeats
  });

  it("feedback 0 → no echoes (dry only)", () => {
    const out = echo(impulse(8), { delayMs: 10, feedback: 0, mix: 1, tailSeconds: 0.05 }).channels[0];
    expect(out[0]).toBeCloseTo(1, 5);
    expect(rms(out, 1)).toBeLessThan(1e-6); // nothing after the dry impulse
  });

  it("mix 0 → dry signal, silent tail, length n + tail", () => {
    const src = burst(0.01, 3);
    const n = src.channels[0].length;
    const out = echo(src, { mix: 0, tailSeconds: 0.1 });
    expect(frameCount(out)).toBe(n + Math.round(0.1 * SR));
    expect(maxAbsDiff(out.channels[0].subarray(0, n), src.channels[0])).toBeLessThan(1e-6);
    expect(rms(out.channels[0], n)).toBeLessThan(1e-9);
  });

  it("automates mix per sample while keeping the echo history live", () => {
    const src = burst(1, 11);
    const opts = { delayMs: 40, feedback: 0.5, mix: 0, eqGainsDb: FLAT, tailSeconds: 0.2 };
    const out = echo(src, {
      ...opts,
      automation: {
        mix: (time, fallback) => (time < 0.5 ? fallback : 1),
      },
    });
    const dry = echo(src, opts);
    const wet = echo(src, { ...opts, mix: 1 });

    expect(segmentMeanAbsDiff(out, dry, 0.1, 0.45)).toBeLessThan(1e-6);
    expect(segmentMeanAbsDiff(out, wet, 0.65, 0.95)).toBeLessThan(1e-6);
    expect(segmentMeanAbsDiff(dry, wet, 0.65, 0.95)).toBeGreaterThan(0.02);
  });

  it("automates feedback into future cumulative repeats", () => {
    const out = echo(impulse(1), {
      delayMs: 100,
      feedback: 0,
      mix: 1,
      eqGainsDb: FLAT,
      tailSeconds: 0.35,
      automation: {
        feedback: (time, fallback) => (time < 0.05 ? fallback : 0.5),
      },
    }).channels[0];
    const d = Math.round(0.1 * SR);

    expect(out[d]).toBeCloseTo(0.5, 6);
    expect(out[2 * d]).toBeCloseTo(0.25, 6);
    expect(out[3 * d]).toBeCloseTo(0.125, 6);
  });

  it("matches static delay time when delay automation is constant", () => {
    const src = burst(1, 13);
    const staticOut = echo(src, { delayMs: 100, feedback: 0.5, mix: 1, eqGainsDb: FLAT, tailSeconds: 0.2 });
    const autoOut = echo(src, {
      delayMs: 10,
      feedback: 0.5,
      mix: 1,
      eqGainsDb: FLAT,
      tailSeconds: 0.2,
      automation: { delayMs: () => 100 },
    });

    expect(maxAbsDiff(autoOut.channels[0], staticOut.channels[0])).toBeLessThan(1e-6);
  });

  it("applies delay time automation to later echo repeats", () => {
    const src = burst(1, 17);
    const long = { delayMs: 100, feedback: 0.5, mix: 1, eqGainsDb: FLAT, tailSeconds: 0.2 };
    const short = { ...long, delayMs: 50 };
    const out = echo(src, {
      ...long,
      automation: { delayMs: (time, fallback) => (time < 0.5 ? fallback : short.delayMs) },
    });
    const longOut = echo(src, long);
    const shortOut = echo(src, short);

    expect(segmentMeanAbsDiff(out, longOut, 0.2, 0.45)).toBeLessThan(1e-6);
    expect(segmentMeanAbsDiff(out, shortOut, 0.65, 0.95)).toBeLessThan(1e-6);
    expect(segmentMeanAbsDiff(longOut, shortOut, 0.65, 0.95)).toBeGreaterThan(0.02);
  });

  it("matches static successive EQ when EQ band automation is constant", () => {
    const src = burst(1, 19);
    const dark = [...FLAT];
    dark[8] = -36;
    const staticOut = echo(src, { delayMs: 100, feedback: 0.5, mix: 1, eqGainsDb: dark, tailSeconds: 0.2 });
    const autoOut = echo(src, {
      delayMs: 100,
      feedback: 0.5,
      mix: 1,
      eqGainsDb: FLAT,
      tailSeconds: 0.2,
      automation: { eqGainsDb: FLAT.map((_, i) => (i === 8 ? () => -36 : undefined)) },
    });

    expect(maxAbsDiff(autoOut.channels[0], staticOut.channels[0])).toBeLessThan(1e-6);
  });

  it("automates successive EQ bands before later repeats", () => {
    const src = impulseAt(0.55);
    const dark = [...FLAT];
    dark[8] = -36;
    const out = echo(src, {
      delayMs: 100,
      feedback: 0.6,
      mix: 1,
      eqGainsDb: FLAT,
      tailSeconds: 0.35,
      automation: { eqGainsDb: FLAT.map((_, i) => (i === 8 ? (time, fallback) => (time < 0.5 ? fallback : -36) : undefined)) },
    });
    const flatOut = echo(src, { delayMs: 100, feedback: 0.6, mix: 1, eqGainsDb: FLAT, tailSeconds: 0.35 });
    const darkOut = echo(src, { delayMs: 100, feedback: 0.6, mix: 1, eqGainsDb: dark, tailSeconds: 0.35 });

    expect(segmentMeanAbsDiff(out, darkOut, 0.6, 0.85)).toBeLessThan(1e-6);
    expect(segmentMeanAbsDiff(flatOut, darkOut, 0.6, 0.85)).toBeGreaterThan(0.0001);
  });

  it("successive equalization: high-cut darkens the repeats, and later echoes are darker than earlier", () => {
    const src = burst(64 / SR, 7);
    const n = src.channels[0].length;
    const D = Math.round(0.3 * SR);
    const hc = echo(src, { delayMs: 300, feedback: 0.6, mix: 1, eqGainsDb: HIGHCUT, tailSeconds: 1 });
    const fl = echo(src, { delayMs: 300, feedback: 0.6, mix: 1, eqGainsDb: FLAT, tailSeconds: 1 });

    // (a) the high-cut removes high-frequency energy from the repeats vs a flat EQ
    const hfHC = rms(highpass(hc, 4000).channels[0], n);
    const hfFL = rms(highpass(fl, 4000).channels[0], n);
    expect(hfHC).toBeLessThan(hfFL * 0.7);

    // (b) the cumulative EQ darkens each successive echo: with the high-cut the HF dies
    // FASTER across repeats than with a flat EQ (whose HF and total both decay at exactly
    // `feedback`, since flat = identity copies).
    const hpHC = highpass(hc, 4000).channels[0];
    const hpFL = highpass(fl, 4000).channels[0];
    const W = 2048;
    const hfDecay = (hp: Float32Array) => rms(hp, 2 * D, 2 * D + W) / Math.max(1e-12, rms(hp, D, D + W));
    expect(hfDecay(hpHC)).toBeLessThan(hfDecay(hpFL) * 0.95);
  });

  it("output length is n + tail", () => {
    const src = burst(0.02, 1);
    const n = src.channels[0].length;
    expect(frameCount(echo(src, { tailSeconds: 1 }))).toBe(n + Math.round(1 * SR));
  });

  it("is deterministic", () => {
    const src = burst(0.02, 9);
    const a = echo(src, { feedback: 0.5 });
    const b = echo(src, { feedback: 0.5 });
    expect(maxAbsDiff(a.channels[0], b.channels[0])).toBe(0);
  });

  it("does not mutate the input", () => {
    const src = burst(0.02, 2);
    const snap = Float32Array.from(src.channels[0]);
    echo(src, { feedback: 0.6, mix: 1 });
    expect(maxAbsDiff(src.channels[0], snap)).toBe(0);
  });

  it("processes stereo independently with repeats in both channels", () => {
    const src = burst(64 / SR, 5, 2);
    const n = src.channels[0].length;
    const out = echo(src, { feedback: 0.6, mix: 1, tailSeconds: 0.5 });
    expect(out.channels.length).toBe(2);
    expect(rms(out.channels[0], n)).toBeGreaterThan(0);
    expect(rms(out.channels[1], n)).toBeGreaterThan(0);
  });

  it("handles an empty buffer", () => {
    expect(frameCount(echo(createAudioData(1, 0, SR), {}))).toBe(0);
  });

  it("stays finite and in range even with a boosting EQ at high feedback and short delay", () => {
    // A positive-gain EQ compounds in the cumulative feedback path; the output must
    // never carry Infinity/NaN and must stay within [-1, 1].
    const src = burst(0.02, 4);
    for (const boost of [6, 12, 24]) {
      const out = echo(src, {
        delayMs: 2,
        feedback: 0.95,
        mix: 1,
        eqGainsDb: new Array(10).fill(boost),
        tailSeconds: 0.5,
      });
      for (const ch of out.channels) {
        for (const v of ch) {
          expect(Number.isFinite(v)).toBe(true);
          expect(Math.abs(v)).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});
