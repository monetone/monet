// ─────────────────────────────────────────────────────────────
// engine/analysis/detect-audio-regions.test — Audition-style Mark Audio core
// ─────────────────────────────────────────────────────────────
// Pins the non-silent-region finder: phrases separated by silence become
// distinct regions at their true times, leading/trailing silence is skipped,
// brief internal dips don't split a phrase, and tiny blips are dropped.

import { describe, expect, it } from "vitest";
import { concat, createAudioData } from "../audio/buffer";
import { sine } from "../generate/tone";
import { detectAudioRegions } from "./detect";

const SR = 44100;
const tone = (sec: number) => sine(440, sec, { sampleRate: SR, amplitude: 0.6 });
const silence = (sec: number) => createAudioData(1, Math.round(sec * SR), SR);

describe("detectAudioRegions", () => {
  it("finds one region per phrase at its true time", () => {
    const clip = concat(tone(0.2), silence(0.5), tone(0.2), silence(0.5), tone(0.2));
    const r = detectAudioRegions(clip, { thresholdDb: -50, minSilenceMs: 300, minAudioMs: 100 });
    expect(r).toHaveLength(3);
    expect(r[0].start).toBeCloseTo(0, 2);
    expect(r[0].end).toBeCloseTo(0.2, 2);
    expect(r[1].start).toBeCloseTo(0.7, 2);
    expect(r[1].end).toBeCloseTo(0.9, 2);
    expect(r[2].start).toBeCloseTo(1.4, 2);
    expect(r[2].end).toBeCloseTo(1.6, 2);
  });

  it("skips leading and trailing silence", () => {
    const r = detectAudioRegions(concat(silence(0.4), tone(0.2), silence(0.4)), { thresholdDb: -50, minSilenceMs: 300 });
    expect(r).toHaveLength(1);
    expect(r[0].start).toBeCloseTo(0.4, 2);
    expect(r[0].end).toBeCloseTo(0.6, 2);
  });

  it("does not split on a gap shorter than minSilenceMs", () => {
    const r = detectAudioRegions(concat(tone(0.2), silence(0.1), tone(0.2)), { thresholdDb: -50, minSilenceMs: 300 });
    expect(r).toHaveLength(1); // 100 ms dip < 300 ms → one phrase
  });

  it("drops regions shorter than minAudioMs", () => {
    const r = detectAudioRegions(concat(tone(0.05), silence(0.5), tone(0.3)), { thresholdDb: -50, minSilenceMs: 300, minAudioMs: 100 });
    expect(r).toHaveLength(1); // the 50 ms blip is dropped
    expect(r[0].end - r[0].start).toBeGreaterThan(0.2);
  });

  it("returns no regions for all-silence and one for silence-free audio", () => {
    expect(detectAudioRegions(silence(0.6), { minSilenceMs: 300 })).toHaveLength(0);
    const whole = detectAudioRegions(tone(0.4), { minSilenceMs: 300 });
    expect(whole).toHaveLength(1);
    expect(whole[0].start).toBeCloseTo(0, 3);
    expect(whole[0].end).toBeCloseTo(0.4, 2);
  });

  it("pads regions outward when asked", () => {
    const base = detectAudioRegions(concat(silence(0.4), tone(0.2), silence(0.4)), { thresholdDb: -50, minSilenceMs: 300 });
    const padded = detectAudioRegions(concat(silence(0.4), tone(0.2), silence(0.4)), { thresholdDb: -50, minSilenceMs: 300, padMs: 50 });
    expect(padded[0].start).toBeLessThan(base[0].start);
    expect(padded[0].end).toBeGreaterThan(base[0].end);
  });

  it("respects the silence threshold", () => {
    const quiet = sine(440, 0.3, { sampleRate: SR, amplitude: 0.002 }); // ~−54 dB
    expect(detectAudioRegions(quiet, { thresholdDb: -40, minSilenceMs: 100 })).toHaveLength(0); // below −40 → silence
    expect(detectAudioRegions(quiet, { thresholdDb: -70, minSilenceMs: 100 })).toHaveLength(1); // above −70 → audio
  });

  it("is deterministic and handles an empty buffer", () => {
    const clip = concat(tone(0.2), silence(0.4), tone(0.2));
    expect(detectAudioRegions(clip)).toEqual(detectAudioRegions(clip));
    expect(detectAudioRegions(createAudioData(1, 0, SR))).toHaveLength(0);
  });
});
