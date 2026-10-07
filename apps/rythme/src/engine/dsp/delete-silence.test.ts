// ─────────────────────────────────────────────────────────────
// engine/dsp/delete-silence.test — Audition-style Delete Silence
// ─────────────────────────────────────────────────────────────
// Pins the gap-trimming: a tone·silence·tone clip has its gap shortened to the
// kept amount (the two tones survive, adjacent), keepMs=0 removes the gap
// entirely, gaps shorter than minSilenceMs are left alone, and silence-free
// audio passes through untouched.

import { describe, expect, it } from "vitest";
import { concat, createAudioData } from "../audio/buffer";
import { frameCount, type AudioData } from "../audio/types";
import { sine } from "../generate/tone";
import { deleteSilence } from "./delete-silence";

const SR = 44100;
const durMs = (d: AudioData) => (frameCount(d) / SR) * 1000;

/** tone(aMs) · silence(silMs) · tone(bMs), mono unless channels given. */
function clip(aMs: number, silMs: number, bMs: number, channels = 1): AudioData {
  const a = sine(440, aMs / 1000, { sampleRate: SR, amplitude: 0.6, channels });
  const sil = createAudioData(channels, Math.round((silMs / 1000) * SR), SR);
  const b = sine(440, bMs / 1000, { sampleRate: SR, amplitude: 0.6, channels });
  return concat(a, sil, b);
}

function rms(ch: Float32Array, a: number, b: number): number {
  let s = 0;
  for (let i = a; i < b; i++) s += ch[i] * ch[i];
  return Math.sqrt(s / Math.max(1, b - a));
}

function maxAbsDiff(a: Float32Array, b: Float32Array): number {
  let m = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

describe("deleteSilence — trimming", () => {
  it("shortens a 500 ms gap to the kept amount", () => {
    const out = deleteSilence(clip(200, 500, 200), { thresholdDb: -50, minSilenceMs: 200, keepMs: 100 });
    expect(durMs(out)).toBeCloseTo(500, 0); // 200 + 100 + 200
  });

  it("removes the gap entirely with keepMs=0", () => {
    const out = deleteSilence(clip(200, 500, 200), { thresholdDb: -50, minSilenceMs: 200, keepMs: 0 });
    expect(durMs(out)).toBeCloseTo(400, 0); // 200 + 200
  });

  it("keeps both tones with silence between them", () => {
    const out = deleteSilence(clip(200, 500, 200), { thresholdDb: -50, minSilenceMs: 200, keepMs: 100 });
    const ch = out.channels[0];
    const n = ch.length;
    expect(rms(ch, 0, Math.round(0.05 * SR))).toBeGreaterThan(0.1); // first tone
    expect(rms(ch, n - Math.round(0.05 * SR), n)).toBeGreaterThan(0.1); // last tone
    expect(rms(ch, Math.round(0.24 * SR), Math.round(0.26 * SR))).toBeLessThan(0.01); // kept silence in the middle
  });

  it("leaves gaps shorter than minSilenceMs alone", () => {
    const c = clip(200, 100, 200); // 100 ms gap < 200 ms threshold
    const out = deleteSilence(c, { minSilenceMs: 200, keepMs: 0 });
    expect(frameCount(out)).toBe(frameCount(c));
  });

  it("collapses an all-silence buffer to the kept amount", () => {
    const sil = createAudioData(1, Math.round(0.6 * SR), SR);
    expect(durMs(deleteSilence(sil, { minSilenceMs: 200, keepMs: 100 }))).toBeCloseTo(100, 0);
    expect(frameCount(deleteSilence(sil, { minSilenceMs: 200, keepMs: 0 }))).toBe(0);
  });
});

describe("deleteSilence — robustness", () => {
  it("passes silence-free audio through unchanged", () => {
    const tone = sine(440, 0.3, { sampleRate: SR, amplitude: 0.6 });
    const out = deleteSilence(tone);
    expect(frameCount(out)).toBe(frameCount(tone));
    expect(maxAbsDiff(out.channels[0], tone.channels[0])).toBe(0);
  });

  it("cuts every channel at the same positions (stereo stays aligned)", () => {
    const c = clip(200, 500, 200, 2);
    const out = deleteSilence(c, { keepMs: 100 });
    expect(out.channels).toHaveLength(2);
    expect(frameCount(out)).toBeGreaterThan(0);
    // identical L/R in → identical L/R out (same cut positions)
    expect(maxAbsDiff(out.channels[0], out.channels[1])).toBe(0);
  });

  it("does not mutate the input", () => {
    const c = clip(200, 500, 200);
    const snapshot = Float32Array.from(c.channels[0]);
    deleteSilence(c, { keepMs: 50 });
    expect(maxAbsDiff(c.channels[0], snapshot)).toBe(0);
  });

  it("is deterministic", () => {
    const c = clip(200, 400, 200);
    const a = deleteSilence(c, { keepMs: 80 });
    const b = deleteSilence(c, { keepMs: 80 });
    expect(maxAbsDiff(a.channels[0], b.channels[0])).toBe(0);
    expect(frameCount(a)).toBe(frameCount(b));
  });

  it("handles an empty buffer", () => {
    expect(frameCount(deleteSilence(createAudioData(1, 0, SR)))).toBe(0);
  });

  it("trims multiple gaps in one pass", () => {
    const seg = (toneMs: number, silMs: number) =>
      concat(sine(440, toneMs / 1000, { sampleRate: SR, amplitude: 0.6 }), createAudioData(1, Math.round((silMs / 1000) * SR), SR));
    const multi = concat(seg(150, 400), seg(150, 400), sine(440, 0.15, { sampleRate: SR, amplitude: 0.6 }));
    const out = deleteSilence(multi, { minSilenceMs: 200, keepMs: 50 });
    // two 400 ms gaps → two 50 ms gaps: removed 2×350 ms ≈ 700 ms
    expect(durMs(out)).toBeCloseTo(durMs(multi) - 700, 0);
  });
});
