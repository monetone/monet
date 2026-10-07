// ─────────────────────────────────────────────────────────────
// engine/analysis/spectrogram.test — Audition-style Spectral Frequency Display
// ─────────────────────────────────────────────────────────────
// Pins the STFT matrix: the right dimensions, a steady tone parks its energy at
// its frequency bin in every frame, a chirp's dominant bin sweeps upward over
// time, a full-scale tone reads ~0 dB, and silence floors at minDb.

import { describe, expect, it } from "vitest";
import { createAudioData } from "../audio/buffer";
import { chirp, sine } from "../generate/tone";
import { spectrogram, spectrogramPeakTrack } from "./spectrogram";

const SR = 44100;

describe("spectrogram — shape", () => {
  it("has the right matrix dimensions", () => {
    const fftSize = 1024;
    const hop = 256;
    const d = sine(1000, 0.3, { sampleRate: SR, amplitude: 0.8 });
    const s = spectrogram(d, { fftSize, hop });
    const n = d.channels[0].length;
    expect(s.bins).toBe(fftSize / 2 + 1);
    expect(s.frames).toBe(Math.floor((n - fftSize) / hop) + 1);
    expect(s.db.length).toBe(s.frames * s.bins);
    expect(s.times.length).toBe(s.frames);
    expect(s.freqs.length).toBe(s.bins);
    expect(s.freqs[s.bins - 1]).toBeCloseTo(SR / 2, 0); // top bin is Nyquist
  });

  it("fewer overlapping frames for a larger hop", () => {
    const d = sine(1000, 0.3, { sampleRate: SR, amplitude: 0.8 });
    expect(spectrogram(d, { fftSize: 1024, hop: 512 }).frames).toBeLessThan(spectrogram(d, { fftSize: 1024, hop: 128 }).frames);
  });

  it("a short buffer yields a single frame", () => {
    expect(spectrogram(sine(1000, 0.005, { sampleRate: SR, amplitude: 0.5 }), { fftSize: 1024 }).frames).toBe(1);
  });
});

describe("spectrogram — content", () => {
  it("parks a steady tone at its frequency bin across every frame", () => {
    const s = spectrogram(sine(2000, 0.3, { sampleRate: SR, amplitude: 0.8 }), { fftSize: 1024 });
    const track = spectrogramPeakTrack(s);
    const binWidth = SR / 1024;
    for (let f = 0; f < s.frames; f++) expect(Math.abs(track[f] - 2000)).toBeLessThan(1.5 * binWidth);
  });

  it("reads ~0 dB for a bin-aligned full-scale sine", () => {
    const binHz = (Math.round((2000 * 1024) / SR) * SR) / 1024;
    const s = spectrogram(sine(binHz, 0.3, { sampleRate: SR, amplitude: 1.0 }), { fftSize: 1024 });
    expect(s.maxDb).toBeCloseTo(0, 0);
  });

  it("sweeps the dominant bin upward for a rising chirp", () => {
    const s = spectrogram(chirp(500, 8000, 0.5, { sampleRate: SR, amplitude: 0.9 }), { fftSize: 1024 });
    const track = spectrogramPeakTrack(s);
    expect(track[2]).toBeLessThan(2000); // starts low
    expect(track[s.frames - 3]).toBeGreaterThan(5000); // ends high
    expect(track[s.frames - 3]).toBeGreaterThan(track[2]); // rises over time
  });

  it("floors at minDb for silence", () => {
    const s = spectrogram(createAudioData(1, 4096, SR), { fftSize: 1024, minDb: -120 });
    expect(s.maxDb).toBe(-120);
    for (const v of s.db) expect(v).toBe(-120);
  });

  it("clamps every value to the configured minDb", () => {
    const s = spectrogram(sine(1000, 0.2, { sampleRate: SR, amplitude: 0.001 }), { fftSize: 1024, minDb: -80 });
    for (const v of s.db) expect(v).toBeGreaterThanOrEqual(-80);
  });
});

describe("spectrogram — robustness", () => {
  it("handles an empty buffer as one silent frame", () => {
    const s = spectrogram(createAudioData(1, 0, SR), { fftSize: 1024, minDb: -120 });
    expect(s.frames).toBe(1);
    expect(s.maxDb).toBe(-120);
  });

  it("is deterministic", () => {
    const d = sine(1000, 0.2, { sampleRate: SR, amplitude: 0.5 });
    const a = spectrogram(d, { fftSize: 512 });
    const b = spectrogram(d, { fftSize: 512 });
    expect(a.frames).toBe(b.frames);
    let diff = 0;
    for (let i = 0; i < a.db.length; i++) diff = Math.max(diff, Math.abs(a.db[i] - b.db[i]));
    expect(diff).toBe(0);
  });

  it("down-mixes stereo to one matrix", () => {
    const s = spectrogram(sine(1500, 0.2, { sampleRate: SR, amplitude: 0.6, channels: 2 }), { fftSize: 1024 });
    const track = spectrogramPeakTrack(s);
    expect(Math.abs(track[track.length >> 1] - 1500)).toBeLessThan(1.5 * (SR / 1024));
  });
});
