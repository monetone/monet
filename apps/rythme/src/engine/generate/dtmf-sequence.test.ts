// ─────────────────────────────────────────────────────────────
// engine/generate/dtmf-sequence.test — Audition-style Generate ▸ DTMF Signals
// ─────────────────────────────────────────────────────────────
// Pins the dial-string generator: the right total duration (tones + breaks +
// pauses), each key's correct dual-tone in its own window, silent breaks between
// tones, pause characters, and skipped unknown characters.

import { describe, expect, it } from "vitest";
import { magnitudes } from "../analysis/fft";
import { channelCount, frameCount, type AudioData } from "../audio/types";
import { dtmfSequence } from "./tone";

const SR = 44100;
const durMs = (d: AudioData) => (frameCount(d) / SR) * 1000;

function rms(ch: Float32Array, a: number, b: number): number {
  let s = 0;
  for (let i = a; i < b; i++) s += ch[i] * ch[i];
  return Math.sqrt(s / Math.max(1, b - a));
}
/** Magnitude at `hz` over a window of the channel. */
function binMag(ch: Float32Array, startSample: number, hz: number, fftSize = 4096): number {
  return magnitudes(ch.subarray(startSample, startSample + fftSize), fftSize)[Math.round((hz * fftSize) / SR)];
}

describe("dtmfSequence — timing", () => {
  it("totals tone + break for each key", () => {
    expect(durMs(dtmfSequence("12", { sampleRate: SR, toneMs: 100, breakMs: 50 }))).toBeCloseTo(250, 0); // 100+50+100
    expect(durMs(dtmfSequence("123", { sampleRate: SR, toneMs: 80, breakMs: 40 }))).toBeCloseTo(80 * 3 + 40 * 2, 0);
  });

  it("inserts a pause for a space / comma / dash", () => {
    expect(durMs(dtmfSequence("1,2", { sampleRate: SR, toneMs: 100, breakMs: 50, pauseMs: 500 }))).toBeCloseTo(700, 0); // 100+500+100
  });

  it("skips unknown characters", () => {
    expect(durMs(dtmfSequence("1x2", { sampleRate: SR, toneMs: 100, breakMs: 50 }))).toBeCloseTo(250, 0); // == "12"
  });

  it("returns an empty buffer for an empty / all-unknown string", () => {
    expect(frameCount(dtmfSequence("", { sampleRate: SR }))).toBe(0);
    expect(frameCount(dtmfSequence("xyz", { sampleRate: SR }))).toBe(0);
  });
});

describe("dtmfSequence — content", () => {
  it("plays each key's dual-tone in its own window, with silent breaks", () => {
    const ch = dtmfSequence("12", { sampleRate: SR, toneMs: 100, breakMs: 50 }).channels[0];
    const toneN = Math.round(0.1 * SR);
    const breakN = Math.round(0.05 * SR);
    // key "1" = 697 + 1209
    expect(binMag(ch, 0, 697)).toBeGreaterThan(100);
    expect(binMag(ch, 0, 1209)).toBeGreaterThan(100);
    expect(binMag(ch, 0, 770)).toBeLessThan(100); // not part of "1"
    // break is silent
    expect(rms(ch, toneN + 5, toneN + breakN - 5)).toBeLessThan(1e-4);
    // key "2" = 697 + 1336 (window starts after tone + break)
    const k2 = toneN + breakN;
    expect(binMag(ch, k2, 697)).toBeGreaterThan(100);
    expect(binMag(ch, k2, 1336)).toBeGreaterThan(100);
  });

  it("handles * and # keys", () => {
    const ch = dtmfSequence("*", { sampleRate: SR, toneMs: 120 }).channels[0];
    expect(binMag(ch, 0, 941)).toBeGreaterThan(100); // * = 941 + 1209
    expect(binMag(ch, 0, 1209)).toBeGreaterThan(100);
  });
});

describe("dtmfSequence — robustness", () => {
  it("respects the channel count and is deterministic", () => {
    const a = dtmfSequence("90", { sampleRate: SR, toneMs: 100, breakMs: 50, channels: 2 });
    const b = dtmfSequence("90", { sampleRate: SR, toneMs: 100, breakMs: 50, channels: 2 });
    expect(channelCount(a)).toBe(2);
    let diff = 0;
    for (let i = 0; i < a.channels[1].length; i++) diff = Math.max(diff, Math.abs(a.channels[1][i] - b.channels[1][i]));
    expect(diff).toBe(0);
  });
});
