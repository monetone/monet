// ─────────────────────────────────────────────────────────────
// engine/dsp/auto-pitch.test — Audition-style Automatic Pitch Correction
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { createAudioData } from "../audio/buffer";
import { frameCount, type AudioData } from "../audio/types";
import { sine } from "../generate/tone";
import { whiteNoise } from "../generate/noise";
import { autoPitchCorrect, detectPitch } from "./auto-pitch";

const SR = 44100;

const tone = (freq: number, amp = 0.5) => sine(freq, 0.5, { sampleRate: SR, amplitude: amp });

function maxAbsDiff(a: Float32Array, b: Float32Array): number {
  let m = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

describe("detectPitch", () => {
  it("estimates the fundamental of a clean tone within 1% across the range", () => {
    // Sweep the advertised band, including low fundamentals (a YIN regression guard).
    for (const f of [80, 100, 150, 220, 440, 880, 1500]) {
      expect(Math.abs(detectPitch(tone(f)) - f) / f).toBeLessThan(0.01);
    }
  });

  it("returns 0 for broadband noise (no clear pitch)", () => {
    const noise: AudioData = { sampleRate: SR, channels: [whiteNoise(0.5, { sampleRate: SR, amplitude: 0.5, seed: 1 }).channels[0]] };
    expect(detectPitch(noise)).toBe(0);
  });
});

describe("autoPitchCorrect", () => {
  it("snaps a detuned tone to the nearest semitone", () => {
    // 450 Hz sits between A4 (440) and A#4 (~466); nearest is A4.
    const out = autoPitchCorrect(tone(450), { referenceHz: 440, strength: 1 });
    const corrected = detectPitch(out);
    expect(Math.abs(corrected - 440) / 440).toBeLessThan(0.01);
    // and it moved meaningfully from the original 450.
    expect(corrected).toBeLessThan(448);
  });

  it("leaves an on-pitch tone essentially unchanged", () => {
    const t = tone(440);
    const out = autoPitchCorrect(t, { referenceHz: 440, strength: 1 });
    expect(Math.abs(detectPitch(out) - 440) / 440).toBeLessThan(0.01);
    expect(maxAbsDiff(out.channels[0], t.channels[0])).toBeLessThan(1e-6); // shift ≈ 0 → clone
  });

  it("corrects roughly halfway at strength 0.5", () => {
    const out = autoPitchCorrect(tone(450), { referenceHz: 440, strength: 0.5 });
    const corrected = detectPitch(out);
    // Between the original 450 and the fully-corrected 440.
    expect(corrected).toBeLessThan(450);
    expect(corrected).toBeGreaterThan(441);
  });

  it("returns a signal with no detectable pitch unchanged", () => {
    const noise: AudioData = { sampleRate: SR, channels: [whiteNoise(0.4, { sampleRate: SR, amplitude: 0.5, seed: 2 }).channels[0]] };
    const snap = Float32Array.from(noise.channels[0]);
    const out = autoPitchCorrect(noise, {});
    expect(maxAbsDiff(out.channels[0], snap)).toBe(0);
  });

  it("preserves frame count and is deterministic", () => {
    const t = tone(450);
    const a = autoPitchCorrect(t, {});
    const b = autoPitchCorrect(t, {});
    expect(frameCount(a)).toBe(frameCount(t));
    expect(maxAbsDiff(a.channels[0], b.channels[0])).toBe(0);
  });

  it("does not mutate the input", () => {
    const t = tone(450);
    const snap = Float32Array.from(t.channels[0]);
    autoPitchCorrect(t, { strength: 1 });
    expect(maxAbsDiff(t.channels[0], snap)).toBe(0);
  });

  it("handles an empty buffer", () => {
    const empty = createAudioData(1, 0, SR);
    const out = autoPitchCorrect(empty, {});
    expect(frameCount(out)).toBe(0);
  });
});
