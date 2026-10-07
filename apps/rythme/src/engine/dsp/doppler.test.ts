// ─────────────────────────────────────────────────────────────
// engine/dsp/doppler.test — Audition-style Doppler Shifter
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { createAudioData, sliceFrames } from "../audio/buffer";
import { channelCount, frameCount, type AudioData } from "../audio/types";
import { sine } from "../generate/tone";
import { spectrum } from "../analysis/spectrum";
import { rmsAmplitude } from "./normalize";
import { doppler } from "./doppler";

const SR = 44100;

/** Dominant frequency (Hz) of a buffer via its average magnitude spectrum. */
function dominantHz(d: AudioData): number {
  const { freqs, db } = spectrum(d, { fftSize: 4096 });
  let best = 1;
  for (let i = 1; i < db.length; i++) if (db[i] > db[best]) best = i;
  return freqs[best];
}

describe("doppler", () => {
  it("sweeps pitch high→low as the source passes (approach then recede)", () => {
    const tone = sine(440, 1, { sampleRate: SR, amplitude: 0.7 });
    const out = doppler(tone, { speed: 80, closestDistance: 3 });
    const n = frameCount(out);
    const early = sliceFrames(out, Math.floor(n * 0.2), Math.floor(n * 0.4));
    const late = sliceFrames(out, Math.floor(n * 0.6), Math.floor(n * 0.8));
    expect(dominantHz(early)).toBeGreaterThan(445); // approaching → higher than source
    expect(dominantHz(late)).toBeLessThan(435); // receding → lower than source
    expect(dominantHz(early)).toBeGreaterThan(dominantHz(late));
  });

  it("amplitude bells — loudest at the closest approach (middle)", () => {
    const tone = sine(440, 1, { sampleRate: SR, amplitude: 0.7 });
    const out = doppler(tone, { speed: 60, closestDistance: 3 });
    const n = frameCount(out);
    const mid = rmsAmplitude(sliceFrames(out, Math.floor(n * 0.45), Math.floor(n * 0.55)));
    const edge = rmsAmplitude(sliceFrames(out, 0, Math.floor(n * 0.1)));
    expect(mid).toBeGreaterThan(edge * 3);
  });

  it("speed 0 is a no-op (stationary source)", () => {
    const tone = sine(440, 0.2, { sampleRate: SR, amplitude: 0.7 });
    const out = doppler(tone, { speed: 0 });
    expect(Array.from(out.channels[0])).toEqual(Array.from(tone.channels[0]));
  });

  it("preserves channel + frame count and processes stereo", () => {
    const tone = sine(440, 0.5, { sampleRate: SR, amplitude: 0.6, channels: 2 });
    const out = doppler(tone, { speed: 40, closestDistance: 5 });
    expect(channelCount(out)).toBe(2);
    expect(frameCount(out)).toBe(frameCount(tone));
  });

  it("is deterministic", () => {
    const tone = sine(330, 0.4, { sampleRate: SR, amplitude: 0.6 });
    const a = doppler(tone, { speed: 50 });
    const b = doppler(tone, { speed: 50 });
    expect(Array.from(a.channels[0])).toEqual(Array.from(b.channels[0]));
  });

  it("does not mutate its input", () => {
    const tone = sine(440, 0.3, { sampleRate: SR, amplitude: 0.6 });
    const copy = Array.from(tone.channels[0]);
    doppler(tone, { speed: 60, closestDistance: 2 });
    expect(Array.from(tone.channels[0])).toEqual(copy);
  });

  it("handles an empty buffer", () => {
    const out = doppler(createAudioData(2, 0, SR), { speed: 30 });
    expect(channelCount(out)).toBe(2);
    expect(frameCount(out)).toBe(0);
  });

  it("produces only finite samples", () => {
    const tone = sine(440, 0.4, { sampleRate: SR, amplitude: 0.8 });
    const out = doppler(tone, { speed: 120, closestDistance: 1 });
    for (const v of out.channels[0]) expect(Number.isFinite(v)).toBe(true);
  });
});
