// ─────────────────────────────────────────────────────────────
// engine/dsp/stretch.test — Audition-style Stretch and Pitch
// ─────────────────────────────────────────────────────────────
// Time-stretch must scale duration but keep pitch; pitch-shift must scale pitch
// but keep duration. We verify pitch via the dominant bin of the spectrum.

import { describe, expect, it } from "vitest";
import { createAudioData } from "../audio/buffer";
import { channelCount, frameCount, type AudioData } from "../audio/types";
import { sine } from "../generate/tone";
import { spectrum } from "../analysis/spectrum";
import { pitchShift, timeStretch } from "./stretch";

const SR = 44100;

/** Dominant frequency (Hz) of a buffer via its average magnitude spectrum. */
function dominantHz(d: AudioData): number {
  const { freqs, db } = spectrum(d, { fftSize: 8192 });
  let best = 0;
  for (let i = 1; i < db.length; i++) if (db[i] > db[best]) best = i;
  return freqs[best];
}

describe("timeStretch", () => {
  it("doubles the duration while keeping the pitch (factor 2)", () => {
    const tone = sine(440, 0.5, { sampleRate: SR, amplitude: 0.6 });
    const out = timeStretch(tone, 2);
    expect(frameCount(out)).toBe(Math.round(frameCount(tone) * 2));
    expect(dominantHz(out)).toBeCloseTo(440, -1); // within ~5 Hz / a couple bins
  });

  it("halves the duration while keeping the pitch (factor 0.5)", () => {
    const tone = sine(440, 0.5, { sampleRate: SR, amplitude: 0.6 });
    const out = timeStretch(tone, 0.5);
    expect(frameCount(out)).toBe(Math.round(frameCount(tone) * 0.5));
    expect(Math.abs(dominantHz(out) - 440)).toBeLessThan(15);
  });

  it("factor 1 is an identity clone", () => {
    const tone = sine(440, 0.1, { sampleRate: SR, amplitude: 0.6 });
    const out = timeStretch(tone, 1);
    expect(Array.from(out.channels[0])).toEqual(Array.from(tone.channels[0]));
    expect(out.channels[0]).not.toBe(tone.channels[0]);
  });

  it("throws on a non-positive factor", () => {
    expect(() => timeStretch(sine(440, 0.05, { sampleRate: SR }), 0)).toThrow(/> 0/);
  });
});

describe("pitchShift", () => {
  it("shifts up an octave (+12 semitones), preserving duration", () => {
    const tone = sine(440, 0.5, { sampleRate: SR, amplitude: 0.6 });
    const out = pitchShift(tone, 12);
    expect(frameCount(out)).toBe(frameCount(tone));
    expect(Math.abs(dominantHz(out) - 880)).toBeLessThan(20);
  });

  it("shifts down an octave (−12 semitones), preserving duration", () => {
    const tone = sine(440, 0.5, { sampleRate: SR, amplitude: 0.6 });
    const out = pitchShift(tone, -12);
    expect(frameCount(out)).toBe(frameCount(tone));
    expect(Math.abs(dominantHz(out) - 220)).toBeLessThan(15);
  });

  it("shifts up a perfect fifth (+7 semitones) → ~659 Hz", () => {
    const tone = sine(440, 0.5, { sampleRate: SR, amplitude: 0.6 });
    const out = pitchShift(tone, 7);
    expect(Math.abs(dominantHz(out) - 440 * Math.pow(2, 7 / 12))).toBeLessThan(20);
  });

  it("0 semitones is an identity clone", () => {
    const tone = sine(440, 0.1, { sampleRate: SR, amplitude: 0.6 });
    const out = pitchShift(tone, 0);
    expect(Array.from(out.channels[0])).toEqual(Array.from(tone.channels[0]));
  });
});

describe("stretch — shared properties", () => {
  it("processes stereo and preserves channel count", () => {
    const tone = sine(440, 0.4, { sampleRate: SR, amplitude: 0.6, channels: 2 });
    const out = pitchShift(tone, 12);
    expect(channelCount(out)).toBe(2);
    expect(frameCount(out)).toBe(frameCount(tone));
    expect(Math.abs(dominantHz({ sampleRate: SR, channels: [out.channels[1]] }) - 880)).toBeLessThan(20);
  });

  it("is deterministic", () => {
    const tone = sine(330, 0.3, { sampleRate: SR, amplitude: 0.6 });
    const a = pitchShift(tone, 5);
    const b = pitchShift(tone, 5);
    expect(Array.from(a.channels[0])).toEqual(Array.from(b.channels[0]));
  });

  it("does not mutate its input", () => {
    const tone = sine(440, 0.4, { sampleRate: SR, amplitude: 0.6 });
    const copy = Array.from(tone.channels[0]);
    pitchShift(tone, 4);
    timeStretch(tone, 1.5);
    expect(Array.from(tone.channels[0])).toEqual(copy);
  });

  it("handles short and empty buffers without NaN", () => {
    const empty = createAudioData(1, 0, SR);
    expect(frameCount(timeStretch(empty, 2))).toBe(0);
    const short = sine(440, 0.005, { sampleRate: SR, amplitude: 0.5 }); // < one FFT frame
    const out = pitchShift(short, 12);
    expect(frameCount(out)).toBe(frameCount(short));
    for (const v of out.channels[0]) expect(Number.isFinite(v)).toBe(true);
  });

  it("extreme stretch (×4) stays smooth — no overlap dropout or trailing silence", () => {
    const tone = sine(440, 0.5, { sampleRate: SR, amplitude: 0.6 });
    const out = timeStretch(tone, 4);
    expect(frameCount(out)).toBe(Math.round(frameCount(tone) * 4));
    expect(Math.abs(dominantHz(out) - 440)).toBeLessThan(15);
    // The final 10% must still carry signal (the dropped-tail bug left silence).
    const ch = out.channels[0];
    const tailStart = Math.floor(ch.length * 0.9);
    let tailSq = 0;
    let fullSq = 0;
    for (let i = 0; i < ch.length; i++) {
      fullSq += ch[i] * ch[i];
      if (i >= tailStart) tailSq += ch[i] * ch[i];
    }
    const tailRms = Math.sqrt(tailSq / (ch.length - tailStart));
    const fullRms = Math.sqrt(fullSq / ch.length);
    expect(tailRms).toBeGreaterThan(fullRms * 0.5);
  });

  it("extreme pitch shift (+24 semitones) → ~1760 Hz, duration preserved", () => {
    const tone = sine(440, 0.5, { sampleRate: SR, amplitude: 0.6 });
    const out = pitchShift(tone, 24);
    expect(frameCount(out)).toBe(frameCount(tone));
    expect(Math.abs(dominantHz(out) - 1760)).toBeLessThan(40);
  });
});
