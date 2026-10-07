// ─────────────────────────────────────────────────────────────
// engine/dsp/analog-delay.test — Audition-style Analog Delay
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { createAudioData } from "../audio/buffer";
import { frameCount, type AudioData } from "../audio/types";
import { analyzeLevels } from "../analysis/levels";
import { delay } from "./delay";
import { highpass } from "./filter";
import { analogDelay } from "./analog-delay";

const SR = 44100;

/** A mono unit impulse, `n` frames. */
function impulse(n = 4096): AudioData {
  const c = new Float32Array(n);
  c[0] = 1;
  return { sampleRate: SR, channels: [c] };
}

/** Energy (sum of squares) over a sample range. */
function energy(ch: Float32Array, from: number, to: number): number {
  let s = 0;
  for (let i = from; i < Math.min(to, ch.length); i++) s += ch[i] * ch[i];
  return s;
}

/** RMS of the >5 kHz content of a slice — high-frequency measure. */
function highRms(ch: Float32Array, from: number, to: number): number {
  const slice = ch.slice(from, to);
  return analyzeLevels(highpass({ sampleRate: SR, channels: [slice] }, 5000, Math.SQRT1_2, 2)).rms;
}

function maxAbsDiff(a: Float32Array, b: Float32Array): number {
  let m = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

function segmentMaxAbsDiff(a: AudioData, b: AudioData, startSeconds: number, endSeconds: number): number {
  const start = Math.max(0, Math.round(startSeconds * a.sampleRate));
  const end = Math.min(frameCount(a), frameCount(b), Math.round(endSeconds * a.sampleRate));
  let m = 0;
  const channels = Math.min(a.channels.length, b.channels.length);
  for (let c = 0; c < channels; c++) {
    for (let i = start; i < end; i++) m = Math.max(m, Math.abs(a.channels[c][i] - b.channels[c][i]));
  }
  return m;
}

function impulseAt(seconds: number, totalSeconds = 0.8): AudioData {
  const d = createAudioData(1, Math.round(totalSeconds * SR), SR);
  d.channels[0][Math.round(seconds * SR)] = 1;
  return d;
}

describe("analogDelay", () => {
  it("produces decaying echoes at the delay interval", () => {
    const dms = 100;
    const ds = Math.round((dms / 1000) * SR);
    const out = analogDelay(impulse(), { delayMs: dms, feedback: 0.6, mix: 1, tailSeconds: 0.6 });
    const win = 200;
    const echo1 = energy(out.channels[0], ds - win, ds + win);
    const echo2 = energy(out.channels[0], 2 * ds - win, 2 * ds + win);
    expect(echo1).toBeGreaterThan(0);
    expect(echo2).toBeGreaterThan(0);
    expect(echo2).toBeLessThan(echo1); // feedback decay
  });

  it("darkens the repeats vs the clean delay (less HF in the echo region)", () => {
    const dms = 100;
    const ds = Math.round((dms / 1000) * SR);
    const imp = impulse();
    const clean = delay(imp, { delayMs: dms, feedback: 0.6, mix: 1, tailSeconds: 0.6 });
    // driveDb 0 still applies tanh, but at impulse-echo levels it is near-linear,
    // so the HF difference vs the clean delay is dominated by the per-repeat lowpass.
    const analog = analogDelay(imp, { delayMs: dms, feedback: 0.6, toneHz: 2000, driveDb: 0, mix: 1, tailSeconds: 0.6 });
    const from = ds - 50;
    const to = 4 * ds;
    expect(highRms(analog.channels[0], from, to)).toBeLessThan(highRms(clean.channels[0], from, to) * 0.5);
  });

  it("a lower tone setting darkens more than a higher tone setting", () => {
    const dms = 100;
    const ds = Math.round((dms / 1000) * SR);
    const imp = impulse();
    const dark = analogDelay(imp, { delayMs: dms, feedback: 0.6, toneHz: 1500, driveDb: 0, mix: 1, tailSeconds: 0.6 });
    const bright = analogDelay(imp, { delayMs: dms, feedback: 0.6, toneHz: 9000, driveDb: 0, mix: 1, tailSeconds: 0.6 });
    const from = ds - 50;
    const to = 4 * ds;
    expect(highRms(dark.channels[0], from, to)).toBeLessThan(highRms(bright.channels[0], from, to));
  });

  it("keeps a hot, high-feedback loop bounded", () => {
    const loud = sineLike(0.8, 6000);
    const out = analogDelay(loud, { delayMs: 50, feedback: 0.95, driveDb: 18, mix: 0.7, tailSeconds: 0.5 });
    const lv = analyzeLevels(out);
    expect(Number.isFinite(lv.peak)).toBe(true);
    expect(lv.peak).toBeLessThanOrEqual(1);
  });

  it("leaves the dry untouched with a silent tail at mix 0", () => {
    const n = 2048;
    const s = sineLike(0.5, n);
    const out = analogDelay(s, { mix: 0, tailSeconds: 0.3 });
    for (let i = 0; i < n; i++) expect(out.channels[0][i]).toBeCloseTo(s.channels[0][i], 6);
    expect(energy(out.channels[0], n, out.channels[0].length)).toBeLessThan(1e-9);
  });

  it("applies mix automation while keeping the feedback line live", () => {
    const input = sineLike(0.3, SR, 445);
    const dry = analogDelay(input, { delayMs: 50, feedback: 0.35, toneHz: 4000, driveDb: 0, mix: 0, tailSeconds: 0.2 });
    const wet = analogDelay(input, { delayMs: 50, feedback: 0.35, toneHz: 4000, driveDb: 0, mix: 1, tailSeconds: 0.2 });
    const out = analogDelay(input, {
      delayMs: 50,
      feedback: 0.35,
      toneHz: 4000,
      driveDb: 0,
      mix: 0,
      tailSeconds: 0.2,
      automation: { mix: (time) => (time < 0.5 ? 0 : 1) },
    });

    expect(segmentMaxAbsDiff(out, dry, 0.1, 0.45)).toBeLessThan(1e-6);
    expect(segmentMaxAbsDiff(out, wet, 0.65, 0.95)).toBeLessThan(1e-6);
    expect(segmentMaxAbsDiff(dry, wet, 0.65, 0.95)).toBeGreaterThan(0.02);
  });

  it("applies feedback automation to later repeats", () => {
    const input = impulse(1);
    const high = analogDelay(input, { delayMs: 100, feedback: 0.5, toneHz: 8000, driveDb: 0, mix: 1, tailSeconds: 0.35 });
    const out = analogDelay(input, {
      delayMs: 100,
      feedback: 0,
      toneHz: 8000,
      driveDb: 0,
      mix: 1,
      tailSeconds: 0.35,
      automation: { feedback: (time) => (time < 0.05 ? 0 : 0.5) },
    });

    expect(segmentMaxAbsDiff(out, high, 0.15, 0.34)).toBeLessThan(1e-6);
  });

  it("matches static delay time when delay automation is constant", () => {
    const input = sineLike(0.3, SR);
    const opts = { delayMs: 100, feedback: 0, toneHz: 12000, driveDb: 0, mix: 1, tailSeconds: 0.1 };
    const staticOut = analogDelay(input, opts);
    const autoOut = analogDelay(input, {
      ...opts,
      delayMs: 10,
      automation: { delayMs: () => opts.delayMs },
    });

    expect(segmentMaxAbsDiff(autoOut, staticOut, 0.2, 0.95)).toBeLessThan(1e-6);
  });

  it("applies delay time automation to later delayed samples", () => {
    const input = sineLike(0.3, SR, 445);
    const long = { delayMs: 100, feedback: 0, toneHz: 12000, driveDb: 0, mix: 1, tailSeconds: 0.1 };
    const short = { ...long, delayMs: 50 };
    const out = analogDelay(input, {
      ...long,
      automation: { delayMs: (time, fallback) => (time < 0.5 ? fallback : short.delayMs) },
    });
    const longOut = analogDelay(input, long);
    const shortOut = analogDelay(input, short);

    expect(segmentMaxAbsDiff(out, longOut, 0.2, 0.45)).toBeLessThan(1e-6);
    expect(segmentMaxAbsDiff(out, shortOut, 0.65, 0.95)).toBeLessThan(1e-6);
    expect(segmentMaxAbsDiff(longOut, shortOut, 0.65, 0.95)).toBeGreaterThan(0.02);
  });

  it("applies drive automation before delayed samples leave the feedback path", () => {
    const input = sineLike(0.8, SR);
    const opts = { delayMs: 50, feedback: 0, toneHz: 12000, driveDb: 0, mix: 1, tailSeconds: 0.1 };
    const low = analogDelay(input, opts);
    const high = analogDelay(input, { ...opts, driveDb: 18 });
    const out = analogDelay(input, {
      ...opts,
      automation: {
        driveDb: (time, fallback) => (time < 0.5 ? fallback : 18),
      },
    });

    expect(segmentMaxAbsDiff(out, low, 0.1, 0.45)).toBeLessThan(1e-6);
    expect(segmentMaxAbsDiff(out, high, 0.65, 0.95)).toBeLessThan(1e-6);
    expect(segmentMaxAbsDiff(low, high, 0.65, 0.95)).toBeGreaterThan(0.005);
  });

  it("applies tone automation to the feedback-path lowpass", () => {
    const input = impulseAt(0.55, 0.8);
    const delayMs = 50;
    const opts = { delayMs, feedback: 0, toneHz: 1500, driveDb: 0, mix: 1, tailSeconds: 0.1 };
    const low = analogDelay(input, opts);
    const high = analogDelay(input, { ...opts, toneHz: 9000 });
    const out = analogDelay(input, {
      ...opts,
      automation: {
        toneHz: (time, fallback) => (time < 0.5 ? fallback : 9000),
      },
    });
    const repeat = Math.round((0.55 + delayMs / 1000) * SR);

    expect(out.channels[0][repeat]).toBeCloseTo(high.channels[0][repeat], 6);
    expect(Math.abs(high.channels[0][repeat] - low.channels[0][repeat])).toBeGreaterThan(0.1);
  });

  it("extends the output by the tail and is deterministic", () => {
    const n = 2048;
    const s = sineLike(0.4, n);
    const a = analogDelay(s, { tailSeconds: 0.5 });
    const b = analogDelay(s, { tailSeconds: 0.5 });
    expect(frameCount(a)).toBe(n + Math.round(0.5 * SR));
    expect(maxAbsDiff(a.channels[0], b.channels[0])).toBe(0);
  });

  it("does not mutate the input", () => {
    const s = sineLike(0.5, 2048);
    const snap = Float32Array.from(s.channels[0]);
    analogDelay(s, { feedback: 0.7, mix: 0.5 });
    expect(maxAbsDiff(s.channels[0], snap)).toBe(0);
  });

  it("handles an empty buffer", () => {
    const empty = createAudioData(1, 0, SR);
    const out = analogDelay(empty, { tailSeconds: 0.2 });
    expect(frameCount(out)).toBe(Math.round(0.2 * SR));
  });
});

/** A short noise-ish tone burst of `len` samples at amplitude `amp` (deterministic). */
function sineLike(amp: number, len: number, frequency = 440): AudioData {
  const c = new Float32Array(len);
  for (let i = 0; i < len; i++) c[i] = amp * Math.sin((2 * Math.PI * frequency * i) / SR);
  return { sampleRate: SR, channels: [c] };
}
