// ─────────────────────────────────────────────────────────────
// analysis/loudness.test — True Peak (dBTP) + EBU R128 short-term & LRA
// ─────────────────────────────────────────────────────────────
// Drives measureTruePeak (BS.1770-4 Annex 2 oversampling) and the short-term /
// Loudness-Range additions to measureLoudness against analytic anchors: an fs/4
// tone whose samples straddle the peak (true peak ≫ sample peak), a low-freq
// tone (true peak ≈ sample peak), and a loud-then-quiet signal (large LRA).

import { describe, expect, it } from "vitest";
import { concat, fromChannels } from "../audio/buffer";
import { sine } from "../generate/tone";
import { whiteNoise } from "../generate/noise";
import { generateSilence } from "../generate/silence";
import type { AudioData } from "../audio/types";
import { loudnessTimeSeries, measureLoudness, measureTruePeak } from "./loudness";

const SR = 48000;

function samplePeakDb(d: AudioData): number {
  let p = 0;
  for (const ch of d.channels) for (let i = 0; i < ch.length; i++) p = Math.max(p, Math.abs(ch[i]));
  return p > 0 ? 20 * Math.log10(p) : -Infinity;
}

describe("True Peak (dBTP)", () => {
  it("recovers the inter-sample peak of an fs/4 tone (≈ −0.9 dBTP, well above the sample peak)", () => {
    // Samples land at ±0.707·A (a 3 dB dip) but the continuous peak is A = 0.9.
    const t = sine(SR / 4, 1, { sampleRate: SR, amplitude: 0.9, phase: Math.PI / 4 });
    const sp = samplePeakDb(t);
    const tp = measureTruePeak(t).dBTP;
    expect(sp).toBeLessThan(-3); // sample meter undershoots by ~3 dB
    expect(tp).toBeGreaterThan(sp + 2); // oversampling recovers the overshoot
    expect(tp).toBeGreaterThan(-1.6); // close to the analytic −0.92 dBTP
    expect(tp).toBeLessThan(0); // still below full scale
  });

  it("a low-frequency tone's true peak ≈ its sample peak", () => {
    const t = sine(100, 1, { sampleRate: SR, amplitude: 0.5 });
    const sp = samplePeakDb(t);
    const tp = measureTruePeak(t).dBTP;
    expect(tp).toBeGreaterThanOrEqual(sp - 1e-9); // never below the sample peak
    expect(Math.abs(tp - sp)).toBeLessThan(0.3); // negligible inter-sample overshoot
  });

  it("true peak is never below the sample peak (broadband noise)", () => {
    const t = whiteNoise(0.5, { sampleRate: SR, amplitude: 0.3, seed: 7, channels: 2 });
    const sp = samplePeakDb(t);
    const tp = measureTruePeak(t).dBTP;
    expect(Number.isFinite(tp)).toBe(true);
    expect(tp).toBeGreaterThanOrEqual(sp - 1e-9);
  });

  it("silence has −∞ dBTP and one entry per channel", () => {
    const r = measureTruePeak(generateSilence(0.5, 2, SR));
    expect(r.dBTP).toBe(-Infinity);
    expect(r.channels).toEqual([-Infinity, -Infinity]);
  });

  it("reports per-channel true peak (loud left, quiet right)", () => {
    const loud = sine(SR / 4, 0.5, { sampleRate: SR, amplitude: 0.8, phase: Math.PI / 4 }).channels[0];
    const quiet = sine(SR / 4, 0.5, { sampleRate: SR, amplitude: 0.2, phase: Math.PI / 4 }).channels[0];
    const r = measureTruePeak(fromChannels([loud, quiet], SR));
    expect(r.channels[0]).toBeGreaterThan(r.channels[1]);
    expect(r.dBTP).toBeCloseTo(r.channels[0], 6); // overall = the louder channel
  });
});

describe("EBU R128 short-term & Loudness Range", () => {
  it("a steady tone has a near-zero loudness range", () => {
    const l = measureLoudness(sine(300, 8, { sampleRate: SR, amplitude: 0.5 }));
    expect(Number.isFinite(l.shortTermMax)).toBe(true);
    expect(l.range).toBeLessThan(1);
  });

  it("a loud-then-quiet signal has a large loudness range", () => {
    const loud = sine(300, 5, { sampleRate: SR, amplitude: 0.5 });
    const quiet = sine(300, 5, { sampleRate: SR, amplitude: 0.125 }); // −12 dB
    const l = measureLoudness(concat(loud, quiet));
    expect(l.range).toBeGreaterThan(5);
    expect(l.shortTermMax).toBeGreaterThanOrEqual(l.integrated - 1);
  });

  it("distinguishes a dynamic signal from a steady one by loudness range", () => {
    const steady = measureLoudness(sine(300, 10, { sampleRate: SR, amplitude: 0.5 }));
    const dynamic = measureLoudness(
      concat(sine(300, 5, { sampleRate: SR, amplitude: 0.5 }), sine(300, 5, { sampleRate: SR, amplitude: 0.125 })),
    );
    expect(dynamic.range).toBeGreaterThan(steady.range + 4);
  });

  it("exposes the full meter; short buffers report no short-term loudness", () => {
    const l = measureLoudness(sine(1000, 2, { sampleRate: SR, amplitude: 0.5 }));
    expect(Number.isFinite(l.integrated)).toBe(true);
    expect(l.momentaryMax).toBeGreaterThan(-Infinity);
    expect(l.shortTermMax).toBe(-Infinity); // 2 s < one 3 s window
    expect(l.range).toBe(0);
  });
});

describe("loudnessTimeSeries (Loudness Radar)", () => {
  it("tracks a level ramp: the momentary loudness rises over time", () => {
    const quiet = sine(1000, 2, { sampleRate: SR, amplitude: 0.1 });
    const loud = sine(1000, 2, { sampleRate: SR, amplitude: 0.8 });
    const ts = loudnessTimeSeries(concat(quiet, loud));
    const m = ts.momentary;
    expect(m.lufs.length).toBeGreaterThan(10);
    expect(m.lufs[m.lufs.length - 1]).toBeGreaterThan(m.lufs[0] + 6); // ends louder than it starts
  });

  it("momentary window centres are ascending and ~100 ms apart", () => {
    const ts = loudnessTimeSeries(sine(1000, 2, { sampleRate: SR, amplitude: 0.5 }));
    const t = ts.momentary.times;
    expect(t.length).toBe(ts.momentary.lufs.length);
    expect(t[0]).toBeCloseTo(0.2, 2); // centre of the first 400 ms window
    for (let i = 1; i < t.length; i++) {
      expect(t[i]).toBeGreaterThan(t[i - 1]);
      expect(t[i] - t[i - 1]).toBeCloseTo(0.1, 3);
    }
  });

  it("matches measureLoudness for the integrated value and range", () => {
    const d = concat(sine(1000, 5, { sampleRate: SR, amplitude: 0.5 }), sine(1000, 5, { sampleRate: SR, amplitude: 0.125 }));
    const ts = loudnessTimeSeries(d);
    const summary = measureLoudness(d);
    expect(ts.integrated).toBeCloseTo(summary.integrated, 6);
    expect(ts.range).toBeCloseTo(summary.range, 6);
    expect(ts.shortTerm.lufs.length).toBeGreaterThan(3); // 10 s → several short-term windows
  });

  it("a too-short buffer yields empty ladders", () => {
    const ts = loudnessTimeSeries(sine(1000, 0.2, { sampleRate: SR, amplitude: 0.5 }));
    expect(ts.momentary.lufs).toEqual([]);
    expect(ts.shortTerm.lufs).toEqual([]);
  });
});
