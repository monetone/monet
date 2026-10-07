// ─────────────────────────────────────────────────────────────
// engine/dsp/hiss-reduction.test — Audition-style Hiss Reduction
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { createAudioData } from "../audio/buffer";
import { frameCount, type AudioData } from "../audio/types";
import { magnitudes } from "../analysis/fft";
import { sine } from "../generate/tone";
import { whiteNoise } from "../generate/noise";
import { estimateHissFloor, hissReduction } from "./hiss-reduction";

const SR = 44100;

const hiss = (seconds: number, amp = 0.03, seed = 1) => whiteNoise(seconds, { sampleRate: SR, amplitude: amp, seed }).channels[0];

/** RMS over a sample range [from, to). */
function rms(ch: Float32Array, from = 0, to = ch.length): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += ch[i] * ch[i];
  return Math.sqrt(sum / Math.max(1, to - from));
}

/** Hann-windowed FFT magnitude at `freq` over FFT samples starting at `from`. */
function magAt(ch: Float32Array, from: number, freq: number, FFT = 8192): number {
  const slice = ch.subarray(from, from + FFT);
  const win = new Float32Array(FFT);
  for (let i = 0; i < FFT && i < slice.length; i++) win[i] = slice[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT - 1)));
  return magnitudes(win, FFT)[Math.round((freq * FFT) / SR)];
}

function maxAbsDiff(a: Float32Array, b: Float32Array): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

/** A clip: a strong tone for the first half, silence for the second, + hiss everywhere. */
function tonePlusHiss(): AudioData {
  const half = sine(1000, 0.5, { sampleRate: SR, amplitude: 0.4 }).channels[0];
  const n = half.length * 2;
  const noise = hiss(n / SR, 0.02, 3);
  const buf = new Float32Array(n);
  for (let i = 0; i < half.length; i++) buf[i] = half[i];
  for (let i = 0; i < n; i++) buf[i] += noise[i];
  return { sampleRate: SR, channels: [buf] };
}

describe("estimateHissFloor", () => {
  it("estimates a per-bin floor that sits below the signal peaks", () => {
    const s = tonePlusHiss();
    const profile = estimateHissFloor(s, {});
    const bin = Math.round((1000 * profile.fftSize) / SR);
    expect(profile.floor.length).toBe(profile.fftSize / 2 + 1);
    // The 1000 Hz bin's floor (quiet-time percentile) is well below its peak (the tone).
    expect(profile.floor[bin]).toBeLessThan(profile.peak[bin] * 0.5);
    // Floor never exceeds the peak in any bin.
    for (let k = 0; k < profile.floor.length; k++) expect(profile.floor[k]).toBeLessThanOrEqual(profile.peak[k] + 1e-9);
  });

  it("honours a custom fftSize", () => {
    const s = tonePlusHiss();
    const profile = estimateHissFloor(s, { fftSize: 1024 });
    expect(profile.fftSize).toBe(1024);
    expect(profile.floor.length).toBe(1024 / 2 + 1);
  });
});

describe("hissReduction", () => {
  it("reduces broadband hiss", () => {
    const s: AudioData = { sampleRate: SR, channels: [hiss(0.6, 0.03, 1)] };
    const out = hissReduction(s, {});
    expect(rms(out.channels[0])).toBeLessThan(rms(s.channels[0]) * 0.7);
  });

  it("preserves an intermittent tone while cleaning the silent gap", () => {
    const s = tonePlusHiss();
    const n = frameCount(s);
    const mid = n / 2;
    const out = hissReduction(s, {});
    // Silent gap (second half) hiss is strongly reduced…
    expect(rms(out.channels[0], mid, n)).toBeLessThan(rms(s.channels[0], mid, n) * 0.6);
    // …while the 1000 Hz tone in the first half is essentially preserved.
    const inTone = magAt(s.channels[0], 4096, 1000);
    const outTone = magAt(out.channels[0], 4096, 1000);
    expect(outTone).toBeGreaterThan(inTone * 0.7);
  });

  it("is a transparent round-trip at amount 0", () => {
    const s = tonePlusHiss();
    const out = hissReduction(s, { amount: 0 });
    // WOLA reconstruction with full padding is near-exact, not just within 5%.
    expect(maxAbsDiff(out.channels[0], s.channels[0])).toBeLessThan(1e-3);
  });

  it("preserves frame count and is deterministic", () => {
    const s = tonePlusHiss();
    const a = hissReduction(s, {});
    const b = hissReduction(s, {});
    expect(frameCount(a)).toBe(frameCount(s));
    expect(maxAbsDiff(a.channels[0], b.channels[0])).toBe(0);
  });

  it("does not mutate the input", () => {
    const s = tonePlusHiss();
    const snapshot = Float32Array.from(s.channels[0]);
    hissReduction(s, {});
    expect(maxAbsDiff(s.channels[0], snapshot)).toBe(0);
  });

  it("handles an empty buffer", () => {
    const empty = createAudioData(1, 0, SR);
    const out = hissReduction(empty, {});
    expect(frameCount(out)).toBe(0);
  });
});
