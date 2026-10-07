// ─────────────────────────────────────────────────────────────
// engine/dsp/guitar-suite.test — Audition-style Guitar Suite
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { createAudioData } from "../audio/buffer";
import { frameCount, type AudioData } from "../audio/types";
import { magnitudes } from "../analysis/fft";
import { sine } from "../generate/tone";
import { guitarSuite } from "./guitar-suite";

const SR = 44100;
const FFT = 8192;

const tone = (freq: number, amp = 0.3) => sine(freq, 0.3, { sampleRate: SR, amplitude: amp });

/** FFT magnitude at `freq` over a settled slice, Hann-windowed so the strong
 *  fundamental's leakage doesn't contaminate the band/harmonic measurements. */
function magAt(ch: Float32Array, freq: number): number {
  const slice = ch.subarray(ch.length - FFT);
  const win = new Float32Array(FFT);
  for (let i = 0; i < FFT; i++) win[i] = slice[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT - 1)));
  const mags = magnitudes(win, FFT);
  return mags[Math.round((freq * FFT) / SR)];
}

function maxAbsDiff(a: Float32Array, b: Float32Array): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

function segmentMaxAbsDiff(a: Float32Array, b: Float32Array, startSeconds: number, endSeconds: number): number {
  const start = Math.max(0, Math.round(startSeconds * SR));
  const end = Math.min(a.length, b.length, Math.round(endSeconds * SR));
  let m = 0;
  for (let i = start; i < end; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

function burstTone(freq: number, amp = 0.08): AudioData {
  const out = createAudioData(1, SR, SR);
  for (let i = 0; i < SR; i++) {
    const time = i / SR;
    if ((time >= 0.1 && time < 0.3) || (time >= 0.7 && time < 0.9)) {
      out.channels[0][i] = amp * Math.sin((2 * Math.PI * freq * i) / SR);
    }
  }
  return out;
}

describe("guitarSuite", () => {
  it("cabinet voicing band-limits sub-bass and high fizz, passes the mids", () => {
    // Clean mode + low level keeps the overdrive near-linear so the cabinet
    // filter dominates. Compare the magnitude ratio at each band, in vs out.
    const opts = { mode: "clean" as const, driveDb: 6, compress: false, bodyHz: 90, toneHz: 5000 };
    const sub = tone(45, 0.05);
    const mid = tone(1500, 0.05);
    const hi = tone(12000, 0.05);
    const subRatio = magAt(guitarSuite(sub, opts).channels[0], 45) / magAt(sub.channels[0], 45);
    const midRatio = magAt(guitarSuite(mid, opts).channels[0], 1500) / magAt(mid.channels[0], 1500);
    const hiRatio = magAt(guitarSuite(hi, opts).channels[0], 12000) / magAt(hi.channels[0], 12000);
    // Mid passes (near or above unity); sub & high are strongly attenuated relative to mid.
    expect(subRatio).toBeLessThan(midRatio * 0.25);
    expect(hiRatio).toBeLessThan(midRatio * 0.25);
  });

  it("amp overdrive synthesizes a new odd harmonic (3f) within the cabinet band", () => {
    const f = 400; // 3f = 1200 Hz, inside the cabinet passband
    const t = tone(f, 0.3);
    const out = guitarSuite(t, { mode: "lead", driveDb: 18, compress: false });
    // 3f is a significant fraction of the processed fundamental (a real harmonic)…
    expect(magAt(out.channels[0], 3 * f)).toBeGreaterThan(magAt(out.channels[0], f) * 0.05);
    // …and absent from the dry tone.
    expect(magAt(out.channels[0], 3 * f)).toBeGreaterThan(magAt(t.channels[0], 3 * f) * 20 + 1e-3);
  });

  it("presence control lifts the ~3 kHz band", () => {
    const t = tone(3000, 0.05); // at the presence center, clean + low level
    const flat = guitarSuite(t, { mode: "clean", driveDb: 6, compress: false, presenceDb: 0 });
    const lifted = guitarSuite(t, { mode: "clean", driveDb: 6, compress: false, presenceDb: 6 });
    expect(magAt(lifted.channels[0], 3000)).toBeGreaterThan(magAt(flat.channels[0], 3000) * 1.3);
  });

  it("a higher-drive mode adds more harmonic energy than a lower-drive mode", () => {
    const f = 400;
    const t = tone(f, 0.3);
    const clean = guitarSuite(t, { mode: "clean", driveDb: 12, compress: false });
    const lead = guitarSuite(t, { mode: "lead", driveDb: 12, compress: false });
    expect(magAt(lead.channels[0], 3 * f)).toBeGreaterThan(magAt(clean.channels[0], 3 * f));
  });

  it("is an exact passthrough at mix 0", () => {
    const t = tone(400);
    const out = guitarSuite(t, { mix: 0 });
    expect(maxAbsDiff(out.channels[0], t.channels[0])).toBe(0);
  });

  it("applies mix and output automation after the cabinet chain", () => {
    const t = sine(400, 1, { sampleRate: SR, amplitude: 0.3 });
    const wet = guitarSuite(t, { mode: "lead", driveDb: 18, compress: false, mix: 1, outputDb: 6 });
    const out = guitarSuite(t, {
      mode: "lead",
      driveDb: 18,
      compress: false,
      mix: 0,
      outputDb: 0,
      automation: {
        mix: (time) => (time < 0.5 ? 0 : 1),
        outputDb: (time) => (time < 0.5 ? 0 : 6),
      },
    });

    expect(segmentMaxAbsDiff(out.channels[0], t.channels[0], 0.1, 0.45)).toBeLessThan(1e-6);
    expect(segmentMaxAbsDiff(out.channels[0], wet.channels[0], 0.65, 0.95)).toBeLessThan(1e-6);
  });

  it("applies drive automation before cabinet voicing", () => {
    const t = sine(400, 1, { sampleRate: SR, amplitude: 0.3 });
    const low = guitarSuite(t, { mode: "clean", driveDb: 0, compress: false, mix: 1 });
    const high = guitarSuite(t, { mode: "clean", driveDb: 24, compress: false, mix: 1 });
    const out = guitarSuite(t, {
      mode: "clean",
      driveDb: 0,
      compress: false,
      mix: 1,
      automation: { driveDb: (time) => (time < 0.5 ? 0 : 24) },
    });

    expect(segmentMaxAbsDiff(out.channels[0], low.channels[0], 0.1, 0.45)).toBeLessThan(1e-6);
    expect(segmentMaxAbsDiff(out.channels[0], high.channels[0], 0.8, 0.95)).toBeLessThan(1e-3);
    expect(segmentMaxAbsDiff(low.channels[0], high.channels[0], 0.8, 0.95)).toBeGreaterThan(0.02);
  });

  it("applies body automation in the cabinet high-pass stage", () => {
    const t = burstTone(70);
    const base = { mode: "clean" as const, driveDb: 0, compress: false, bodyHz: 40, toneHz: 12000, presenceDb: 0, mix: 1 };
    const low = guitarSuite(t, base);
    const high = guitarSuite(t, { ...base, bodyHz: 250 });
    const out = guitarSuite(t, {
      ...base,
      automation: { bodyHz: (time, fallback) => (time < 0.5 ? fallback : 250) },
    });

    expect(segmentMaxAbsDiff(out.channels[0], low.channels[0], 0.2, 0.28)).toBeLessThan(1e-6);
    expect(segmentMaxAbsDiff(out.channels[0], high.channels[0], 0.8, 0.88)).toBeLessThan(1e-4);
    expect(segmentMaxAbsDiff(low.channels[0], high.channels[0], 0.8, 0.88)).toBeGreaterThan(0.005);
  });

  it("applies tone automation in the cabinet low-pass stage", () => {
    const t = burstTone(9000);
    const base = { mode: "clean" as const, driveDb: 0, compress: false, bodyHz: 40, toneHz: 12000, presenceDb: 0, mix: 1 };
    const bright = guitarSuite(t, base);
    const dark = guitarSuite(t, { ...base, toneHz: 3000 });
    const out = guitarSuite(t, {
      ...base,
      automation: { toneHz: (time, fallback) => (time < 0.5 ? fallback : 3000) },
    });

    expect(segmentMaxAbsDiff(out.channels[0], bright.channels[0], 0.2, 0.28)).toBeLessThan(1e-6);
    expect(segmentMaxAbsDiff(out.channels[0], dark.channels[0], 0.8, 0.88)).toBeLessThan(1e-4);
    expect(segmentMaxAbsDiff(bright.channels[0], dark.channels[0], 0.8, 0.88)).toBeGreaterThan(0.005);
  });

  it("applies presence automation in the cabinet peaking stage", () => {
    const t = burstTone(3000);
    const base = { mode: "clean" as const, driveDb: 0, compress: false, bodyHz: 40, toneHz: 12000, presenceDb: 0, mix: 1 };
    const flat = guitarSuite(t, base);
    const lifted = guitarSuite(t, { ...base, presenceDb: 6 });
    const out = guitarSuite(t, {
      ...base,
      automation: { presenceDb: (time, fallback) => (time < 0.5 ? fallback : 6) },
    });

    expect(segmentMaxAbsDiff(out.channels[0], flat.channels[0], 0.2, 0.28)).toBeLessThan(1e-6);
    expect(segmentMaxAbsDiff(out.channels[0], lifted.channels[0], 0.8, 0.88)).toBeLessThan(1e-4);
    expect(segmentMaxAbsDiff(flat.channels[0], lifted.channels[0], 0.8, 0.88)).toBeGreaterThan(0.005);
  });

  it("preserves frame count and is deterministic", () => {
    const t = tone(400);
    const a = guitarSuite(t, { mode: "crunch" });
    const b = guitarSuite(t, { mode: "crunch" });
    expect(frameCount(a)).toBe(frameCount(t));
    expect(maxAbsDiff(a.channels[0], b.channels[0])).toBe(0);
  });

  it("does not mutate the input", () => {
    const t = tone(400);
    const snapshot = Float32Array.from(t.channels[0]);
    guitarSuite(t, { mode: "lead", driveDb: 18 });
    expect(maxAbsDiff(t.channels[0], snapshot)).toBe(0);
  });

  it("preserves channel count", () => {
    const stereo: AudioData = { sampleRate: SR, channels: [tone(400).channels[0], tone(400).channels[0]] };
    const out = guitarSuite(stereo, { mode: "crunch" });
    expect(out.channels.length).toBe(2);
  });

  it("handles an empty buffer", () => {
    const empty = createAudioData(2, 0, SR);
    const out = guitarSuite(empty, { mode: "lead" });
    expect(frameCount(out)).toBe(0);
  });
});
