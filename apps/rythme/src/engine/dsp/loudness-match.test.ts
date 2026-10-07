// ─────────────────────────────────────────────────────────────
// engine/dsp/loudness-match.test — Audition-style Match Loudness
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { createAudioData } from "../audio/buffer";
import { dbToGain } from "../audio/db";
import { channelCount, frameCount } from "../audio/types";
import { sine } from "../generate/tone";
import { measureLoudness } from "../analysis/loudness";
import { peakAmplitude, rmsAmplitude } from "./normalize";
import { matchLoudness } from "./loudness-match";

const SR = 44100;

describe("matchLoudness", () => {
  it("brings the integrated loudness to the target (within 0.5 LU)", () => {
    const tone = sine(1000, 2, { sampleRate: SR, amplitude: 0.5 });
    for (const target of [-14, -16, -23]) {
      const out = matchLoudness(tone, { targetLufs: target });
      expect(measureLoudness(out).integrated).toBeCloseTo(target, 0); // ±0.5 LU
    }
  });

  it("boosts quiet material and attenuates loud material to the same target", () => {
    const quiet = sine(1000, 2, { sampleRate: SR, amplitude: 0.05 });
    const loud = sine(1000, 2, { sampleRate: SR, amplitude: 0.9 });
    const q = matchLoudness(quiet, { targetLufs: -16 });
    const l = matchLoudness(loud, { targetLufs: -16 });
    expect(rmsAmplitude(q)).toBeGreaterThan(rmsAmplitude(quiet)); // boosted
    expect(rmsAmplitude(l)).toBeLessThan(rmsAmplitude(loud)); // attenuated
    expect(measureLoudness(q).integrated).toBeCloseTo(-16, 0);
    expect(measureLoudness(l).integrated).toBeCloseTo(-16, 0);
  });

  it("returns silent / too-short input unchanged", () => {
    const silent = createAudioData(1, SR, SR); // 1 s of zeros
    const out = matchLoudness(silent, { targetLufs: -16 });
    expect(peakAmplitude(out)).toBe(0);
    const tiny = sine(1000, 0.05, { sampleRate: SR, amplitude: 0.5 }); // < 400 ms block
    const t = matchLoudness(tiny, { targetLufs: -16 });
    expect(Array.from(t.channels[0])).toEqual(Array.from(tiny.channels[0]));
  });

  it("holds the peak ceiling when the loudness gain would clip", () => {
    const quiet = sine(1000, 2, { sampleRate: SR, amplitude: 0.05 });
    const out = matchLoudness(quiet, { targetLufs: -3, peakCeilingDb: -1 });
    expect(peakAmplitude(out)).toBeLessThanOrEqual(dbToGain(-1) + 1e-4);
  });

  it("preserves channel + frame count and processes stereo", () => {
    const tone = sine(1000, 2, { sampleRate: SR, amplitude: 0.4, channels: 2 });
    const out = matchLoudness(tone, { targetLufs: -20 });
    expect(channelCount(out)).toBe(2);
    expect(frameCount(out)).toBe(frameCount(tone));
    expect(measureLoudness(out).integrated).toBeCloseTo(-20, 0);
  });

  it("is deterministic", () => {
    const tone = sine(1000, 1, { sampleRate: SR, amplitude: 0.5 });
    const a = matchLoudness(tone, { targetLufs: -18 });
    const b = matchLoudness(tone, { targetLufs: -18 });
    expect(Array.from(a.channels[0])).toEqual(Array.from(b.channels[0]));
  });

  it("does not mutate its input", () => {
    const tone = sine(1000, 1, { sampleRate: SR, amplitude: 0.5 });
    const copy = Array.from(tone.channels[0]);
    matchLoudness(tone, { targetLufs: -10, peakCeilingDb: -1 });
    expect(Array.from(tone.channels[0])).toEqual(copy);
  });
});
