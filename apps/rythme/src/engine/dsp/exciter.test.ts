// ─────────────────────────────────────────────────────────────
// engine/dsp/exciter.test — Audition-style Harmonic Exciter
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { createAudioData } from "../audio/buffer";
import { frameCount, type AudioData } from "../audio/types";
import { magnitudes } from "../analysis/fft";
import { sine } from "../generate/tone";
import { exciter } from "./exciter";

const SR = 44100;
const FFT = 8192;

const tone = (freq: number, amp = 0.5) => sine(freq, 0.3, { sampleRate: SR, amplitude: amp });

/** FFT magnitude at `freq` over a settled slice (past the high-pass transient). */
function magAt(ch: Float32Array, freq: number): number {
  const slice = ch.subarray(ch.length - FFT); // last FFT samples — fully settled
  const mags = magnitudes(slice, FFT);
  const bin = Math.round((freq * FFT) / SR);
  return mags[bin];
}

function maxAbsDiff(a: Float32Array, b: Float32Array): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

/** Max |a-b| over the settled (second-half) region, past the high-pass transient. */
function settledMaxAbsDiff(a: Float32Array, b: Float32Array): number {
  let m = 0;
  for (let i = a.length >> 1; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

function segmentMaxAbsDiff(a: Float32Array, b: Float32Array, startSeconds: number, endSeconds: number): number {
  const start = Math.max(0, Math.round(startSeconds * SR));
  const end = Math.min(a.length, b.length, Math.round(endSeconds * SR));
  let m = 0;
  for (let i = start; i < end; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

describe("exciter", () => {
  it("tape mode synthesizes an odd harmonic (3f) above the high-pass", () => {
    const f = 5000;
    const t = tone(f);
    const out = exciter(t, { frequency: 3000, driveDb: 15, mix: 0.5, mode: "tape" });
    const dry3f = magAt(t.channels[0], 3 * f);
    const wet3f = magAt(out.channels[0], 3 * f);
    expect(wet3f).toBeGreaterThan(dry3f * 20 + 1e-3);
  });

  it("retro mode synthesizes an odd harmonic (3f) above the high-pass", () => {
    const f = 5000;
    const t = tone(f);
    const out = exciter(t, { frequency: 3000, driveDb: 15, mix: 0.5, mode: "retro" });
    const dry3f = magAt(t.channels[0], 3 * f);
    const wet3f = magAt(out.channels[0], 3 * f);
    expect(wet3f).toBeGreaterThan(dry3f * 20 + 1e-3);
  });

  it("tube mode synthesizes an even harmonic (2f) the symmetric modes do not", () => {
    const f = 5000;
    const t = tone(f);
    const tube = exciter(t, { frequency: 3000, driveDb: 15, mix: 0.5, mode: "tube" });
    const tape = exciter(t, { frequency: 3000, driveDb: 15, mix: 0.5, mode: "tape" });
    const dry2f = magAt(t.channels[0], 2 * f);
    expect(magAt(tube.channels[0], 2 * f)).toBeGreaterThan(dry2f * 20 + 1e-3);
    // tanh is odd → 2f stays near the dry (numerically tiny) level for tape mode.
    expect(magAt(tube.channels[0], 2 * f)).toBeGreaterThan(magAt(tape.channels[0], 2 * f) * 5);
  });

  it("leaves a tone well below the high-pass essentially unchanged", () => {
    const t = tone(500);
    const out = exciter(t, { frequency: 3000, driveDb: 15, mix: 0.5, mode: "tape" });
    // Steady-state: a 500 Hz tone is ~60 dB down through the 24 dB/oct high-pass,
    // so the excited band is negligible once the filter has settled.
    expect(settledMaxAbsDiff(out.channels[0], t.channels[0])).toBeLessThan(0.01);
  });

  it("raises the added harmonic energy monotonically with mix", () => {
    const f = 5000;
    const t = tone(f);
    const low = exciter(t, { frequency: 3000, driveDb: 15, mix: 0.2, mode: "tape" });
    const high = exciter(t, { frequency: 3000, driveDb: 15, mix: 0.6, mode: "tape" });
    expect(magAt(high.channels[0], 3 * f)).toBeGreaterThan(magAt(low.channels[0], 3 * f));
  });

  it("applies mix automation after the high-band detector", () => {
    const t = tone(5000, 0.5);
    const out = exciter(t, {
      frequency: 3000,
      driveDb: 15,
      mix: 0,
      mode: "tape",
      automation: { mix: (time) => (time < 0.5 ? 0 : 0.6) },
    });
    const wet = exciter(t, { frequency: 3000, driveDb: 15, mix: 0.6, mode: "tape" });

    expect(segmentMaxAbsDiff(out.channels[0], t.channels[0], 0.1, 0.45)).toBeLessThan(1e-6);
    expect(segmentMaxAbsDiff(out.channels[0], wet.channels[0], 0.65, 0.95)).toBeLessThan(1e-6);
  });

  it("applies frequency automation before the high-band detector", () => {
    const t = sine(5000, 1, { sampleRate: SR, amplitude: 0.5 });
    const closed = exciter(t, { frequency: 12000, driveDb: 15, mix: 0.6, mode: "tape" });
    const open = exciter(t, { frequency: 1000, driveDb: 15, mix: 0.6, mode: "tape" });
    const out = exciter(t, {
      frequency: 12000,
      driveDb: 15,
      mix: 0.6,
      mode: "tape",
      automation: { frequency: (time, fallback) => (time < 0.5 ? fallback : 1000) },
    });

    expect(segmentMaxAbsDiff(out.channels[0], closed.channels[0], 0.1, 0.45)).toBeLessThan(1e-6);
    expect(segmentMaxAbsDiff(out.channels[0], open.channels[0], 0.8, 0.95)).toBeLessThan(1e-3);
    expect(segmentMaxAbsDiff(closed.channels[0], open.channels[0], 0.8, 0.95)).toBeGreaterThan(0.02);
  });

  it("is an exact passthrough at mix 0", () => {
    const t = tone(5000);
    const out = exciter(t, { mix: 0 });
    expect(maxAbsDiff(out.channels[0], t.channels[0])).toBe(0);
  });

  it("preserves frame count and is deterministic", () => {
    const t = tone(5000);
    const a = exciter(t, { mix: 0.4 });
    const b = exciter(t, { mix: 0.4 });
    expect(frameCount(a)).toBe(frameCount(t));
    expect(maxAbsDiff(a.channels[0], b.channels[0])).toBe(0);
  });

  it("does not mutate the input", () => {
    const t = tone(5000);
    const snapshot = Float32Array.from(t.channels[0]);
    exciter(t, { mix: 0.5, mode: "tube" });
    expect(maxAbsDiff(t.channels[0], snapshot)).toBe(0);
  });

  it("handles an empty buffer", () => {
    const empty = createAudioData(2, 0, SR);
    const out = exciter(empty, { mix: 0.5 });
    expect(frameCount(out)).toBe(0);
  });

  it("up-mixes nothing — preserves channel count", () => {
    const stereo: AudioData = { sampleRate: SR, channels: [tone(5000).channels[0], tone(5000).channels[0]] };
    const out = exciter(stereo, { mix: 0.4 });
    expect(out.channels.length).toBe(2);
  });
});
