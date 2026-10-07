// ─────────────────────────────────────────────────────────────
// engine/dsp/noise-reduction.test — Audition-style spectral denoise
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { createAudioData, fromChannels } from "../audio/buffer";
import { gainToDb } from "../audio/db";
import { channelCount, frameCount, type AudioData } from "../audio/types";
import { sine } from "../generate/tone";
import { whiteNoise } from "../generate/noise";
import { rmsAmplitude } from "./normalize";
import { captureNoiseProfile, reduceNoise } from "./noise-reduction";

const SR = 8000;
const FFT = 1024;

/** Mix two same-shaped buffers sample-by-sample into a new buffer. */
function mix(a: AudioData, b: AudioData): AudioData {
  const out: AudioData = { sampleRate: a.sampleRate, channels: a.channels.map((c) => c.slice()) };
  for (let ch = 0; ch < out.channels.length; ch++) {
    const bc = b.channels[Math.min(ch, b.channels.length - 1)];
    for (let i = 0; i < out.channels[ch].length; i++) out.channels[ch][i] += bc[i];
  }
  return out;
}

function maxAbsDiff(a: Float32Array, b: Float32Array): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

describe("captureNoiseProfile", () => {
  it("returns a per-bin floor + peak of length fftSize/2+1", () => {
    const noise = whiteNoise(0.4, { sampleRate: SR, amplitude: 0.1, seed: 7 });
    const profile = captureNoiseProfile(noise, { fftSize: FFT });
    expect(profile.fftSize).toBe(FFT);
    expect(profile.sampleRate).toBe(SR);
    expect(profile.floor.length).toBe(FFT / 2 + 1);
    expect(profile.peak.length).toBe(FFT / 2 + 1);
    expect(profile.frames).toBeGreaterThan(1);
  });

  it("captures a non-trivial, finite, non-negative floor for real noise", () => {
    const noise = whiteNoise(0.4, { sampleRate: SR, amplitude: 0.1, seed: 7 });
    const { floor, peak } = captureNoiseProfile(noise, { fftSize: FFT });
    let sum = 0;
    for (let k = 0; k < floor.length; k++) {
      expect(Number.isFinite(floor[k])).toBe(true);
      expect(floor[k]).toBeGreaterThanOrEqual(0);
      expect(peak[k]).toBeGreaterThanOrEqual(floor[k] - 1e-9); // peak >= average
      sum += floor[k];
    }
    expect(sum).toBeGreaterThan(0);
  });

  it("throws on a non-power-of-two FFT size", () => {
    const noise = whiteNoise(0.1, { sampleRate: SR });
    expect(() => captureNoiseProfile(noise, { fftSize: 1000 })).toThrow(/power of two/);
  });
});

describe("reduceNoise", () => {
  it("preserves channel count and exact frame count", () => {
    const sig = whiteNoise(0.3, { sampleRate: SR, amplitude: 0.1, seed: 3, channels: 2 });
    const profile = captureNoiseProfile(sig, { fftSize: FFT });
    const out = reduceNoise(sig, profile);
    expect(channelCount(out)).toBe(2);
    expect(frameCount(out)).toBe(frameCount(sig));
  });

  it("amount=0 reconstructs the input (WOLA STFT/ISTFT identity)", () => {
    const sig = sine(300, 0.25, { sampleRate: SR, amplitude: 0.6 });
    const profile = captureNoiseProfile(whiteNoise(0.1, { sampleRate: SR, amplitude: 0.05 }), { fftSize: FFT });
    const out = reduceNoise(sig, profile, { amount: 0 });
    expect(frameCount(out)).toBe(frameCount(sig));
    expect(maxAbsDiff(out.channels[0], sig.channels[0])).toBeLessThan(1e-3);
  });

  it("drops the noise floor by >= 8 dB on a noise-only buffer", () => {
    const noise = whiteNoise(0.5, { sampleRate: SR, amplitude: 0.08, seed: 11 });
    const profile = captureNoiseProfile(noise, { fftSize: FFT });
    const out = reduceNoise(noise, profile, { amount: 1, reduceByDb: 24 });
    const before = gainToDb(rmsAmplitude(noise));
    const after = gainToDb(rmsAmplitude(out));
    expect(before - after).toBeGreaterThanOrEqual(8);
  });

  it("preserves a strong tone while reducing accompanying noise", () => {
    const tone = sine(500, 0.5, { sampleRate: SR, amplitude: 0.5 });
    const noise = whiteNoise(0.5, { sampleRate: SR, amplitude: 0.03, seed: 5 });
    const noisy = mix(tone, noise);
    // Capture the print from a separate noise-only region (same generator).
    const profile = captureNoiseProfile(whiteNoise(0.5, { sampleRate: SR, amplitude: 0.03, seed: 5 }), { fftSize: FFT });
    const out = reduceNoise(noisy, profile, { amount: 1, reduceByDb: 18 });

    const toneRms = gainToDb(rmsAmplitude(tone));
    const outRms = gainToDb(rmsAmplitude(out));
    const noisyRms = gainToDb(rmsAmplitude(noisy));
    // Output level lands close to the clean tone: noise removed, tone kept.
    expect(Math.abs(outRms - toneRms)).toBeLessThanOrEqual(1.5);
    expect(outRms).toBeLessThanOrEqual(noisyRms + 0.1);
  });

  it("outputNoiseOnly returns the residual: denoised + residual ≈ input", () => {
    const noisy = mix(sine(440, 0.3, { sampleRate: SR, amplitude: 0.4 }), whiteNoise(0.3, { sampleRate: SR, amplitude: 0.05, seed: 9 }));
    const profile = captureNoiseProfile(whiteNoise(0.3, { sampleRate: SR, amplitude: 0.05, seed: 9 }), { fftSize: FFT });
    const denoised = reduceNoise(noisy, profile, { amount: 0.8 });
    const residual = reduceNoise(noisy, profile, { amount: 0.8, outputNoiseOnly: true });
    const sum = new Float32Array(frameCount(noisy));
    for (let i = 0; i < sum.length; i++) sum[i] = denoised.channels[0][i] + residual.channels[0][i];
    expect(maxAbsDiff(sum, noisy.channels[0])).toBeLessThan(1e-3);
  });

  it("is deterministic", () => {
    const noisy = mix(sine(320, 0.2, { sampleRate: SR, amplitude: 0.4 }), whiteNoise(0.2, { sampleRate: SR, amplitude: 0.05, seed: 2 }));
    const profile = captureNoiseProfile(whiteNoise(0.2, { sampleRate: SR, amplitude: 0.05, seed: 2 }), { fftSize: FFT });
    const a = reduceNoise(noisy, profile, { amount: 0.85 });
    const b = reduceNoise(noisy, profile, { amount: 0.85 });
    expect(Array.from(a.channels[0])).toEqual(Array.from(b.channels[0]));
  });

  it("handles an empty buffer and a buffer shorter than the FFT size", () => {
    const profile = captureNoiseProfile(whiteNoise(0.1, { sampleRate: SR, amplitude: 0.05 }), { fftSize: FFT });
    const empty = createAudioData(1, 0, SR);
    expect(frameCount(reduceNoise(empty, profile))).toBe(0);

    const tiny = fromChannels([[0.1, -0.2, 0.3, -0.1, 0.05]], SR);
    const out = reduceNoise(tiny, profile, { amount: 0.5 });
    expect(frameCount(out)).toBe(frameCount(tiny));
    for (const v of out.channels[0]) expect(Number.isFinite(v)).toBe(true);
  });

  it("processes both stereo channels independently", () => {
    const left = mix(sine(400, 0.3, { sampleRate: SR, amplitude: 0.5 }), whiteNoise(0.3, { sampleRate: SR, amplitude: 0.05, seed: 4 }));
    const right = whiteNoise(0.3, { sampleRate: SR, amplitude: 0.08, seed: 8 });
    const stereo: AudioData = { sampleRate: SR, channels: [left.channels[0], right.channels[0]] };
    const profile = captureNoiseProfile(whiteNoise(0.3, { sampleRate: SR, amplitude: 0.06, seed: 4 }), { fftSize: FFT });
    const out = reduceNoise(stereo, profile, { amount: 1, reduceByDb: 20 });
    expect(channelCount(out)).toBe(2);
    // The noise-only right channel is attenuated more than the tone-bearing left.
    const leftDrop = rmsAmplitude({ sampleRate: SR, channels: [stereo.channels[0]] }) - rmsAmplitude({ sampleRate: SR, channels: [out.channels[0]] });
    const rightDrop = rmsAmplitude({ sampleRate: SR, channels: [stereo.channels[1]] }) - rmsAmplitude({ sampleRate: SR, channels: [out.channels[1]] });
    expect(rightDrop).toBeGreaterThan(leftDrop);
  });
});
