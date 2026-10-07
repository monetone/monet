// ─────────────────────────────────────────────────────────────
// engine/dsp/pitch-bend.test — Audition-style Pitch Bender
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { createAudioData, sliceFrames } from "../audio/buffer";
import { channelCount, frameCount, type AudioData } from "../audio/types";
import { sine } from "../generate/tone";
import { spectrum } from "../analysis/spectrum";
import { pitchBend } from "./pitch-bend";

const SR = 44100;

/** Dominant frequency (Hz) of a buffer via its average magnitude spectrum. */
function dominantHz(d: AudioData): number {
  const { freqs, db } = spectrum(d, { fftSize: 4096 });
  let best = 1;
  for (let i = 1; i < db.length; i++) if (db[i] > db[best]) best = i;
  return freqs[best];
}

describe("pitchBend", () => {
  it("ramps pitch up (+12) and plays faster (shorter)", () => {
    const tone = sine(440, 1, { sampleRate: SR, amplitude: 0.7 });
    const out = pitchBend(tone, { startSemitones: 0, endSemitones: 12 });
    const n = frameCount(out);
    const early = dominantHz(sliceFrames(out, 0, Math.floor(n * 0.25)));
    const late = dominantHz(sliceFrames(out, Math.floor(n * 0.75), n));
    expect(early).toBeLessThan(560); // ~440 at the start
    expect(late).toBeGreaterThan(740); // ~880 at the end
    expect(late).toBeGreaterThan(early);
    expect(n).toBeLessThan(frameCount(tone)); // higher pitch ⇒ shorter
  });

  it("ramps pitch down (−12) and plays slower (longer)", () => {
    const tone = sine(440, 1, { sampleRate: SR, amplitude: 0.7 });
    const out = pitchBend(tone, { startSemitones: 0, endSemitones: -12 });
    const n = frameCount(out);
    const late = dominantHz(sliceFrames(out, Math.floor(n * 0.75), n));
    expect(late).toBeLessThan(300); // ~220 at the end
    expect(n).toBeGreaterThan(frameCount(tone)); // lower pitch ⇒ longer
  });

  it("start=end=0 is an identity", () => {
    const tone = sine(440, 0.1, { sampleRate: SR, amplitude: 0.6 });
    const out = pitchBend(tone, { startSemitones: 0, endSemitones: 0 });
    expect(frameCount(out)).toBe(frameCount(tone) - 1);
    let maxErr = 0;
    for (let i = 0; i < frameCount(out); i++) maxErr = Math.max(maxErr, Math.abs(out.channels[0][i] - tone.channels[0][i]));
    expect(maxErr).toBeLessThan(1e-6);
  });

  it("an envelope overrides the ramp (V-shape dips the pitch in the middle)", () => {
    const tone = sine(440, 1, { sampleRate: SR, amplitude: 0.7 });
    const out = pitchBend(tone, { envelope: [0, -12, 0] }); // down then back up
    const n = frameCount(out);
    const mid = dominantHz(sliceFrames(out, Math.floor(n * 0.4), Math.floor(n * 0.6)));
    const edge = dominantHz(sliceFrames(out, 0, Math.floor(n * 0.15)));
    expect(mid).toBeLessThan(edge - 30); // middle is lower-pitched than the edges
  });

  it("preserves channel count and processes stereo", () => {
    const tone = sine(440, 0.5, { sampleRate: SR, amplitude: 0.6, channels: 2 });
    const out = pitchBend(tone, { startSemitones: 0, endSemitones: 7 });
    expect(channelCount(out)).toBe(2);
    expect(out.channels[0].length).toBe(out.channels[1].length);
  });

  it("is deterministic", () => {
    const tone = sine(330, 0.4, { sampleRate: SR, amplitude: 0.6 });
    const a = pitchBend(tone, { startSemitones: -3, endSemitones: 5 });
    const b = pitchBend(tone, { startSemitones: -3, endSemitones: 5 });
    expect(Array.from(a.channels[0])).toEqual(Array.from(b.channels[0]));
  });

  it("does not mutate its input and stays finite", () => {
    const tone = sine(440, 0.3, { sampleRate: SR, amplitude: 0.7 });
    const copy = Array.from(tone.channels[0]);
    const out = pitchBend(tone, { startSemitones: 12, endSemitones: -12 });
    expect(Array.from(tone.channels[0])).toEqual(copy);
    for (const v of out.channels[0]) expect(Number.isFinite(v)).toBe(true);
  });

  it("handles an empty buffer", () => {
    const out = pitchBend(createAudioData(2, 0, SR), { endSemitones: 12 });
    expect(channelCount(out)).toBe(2);
    expect(frameCount(out)).toBe(0);
  });
});
