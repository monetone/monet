// ─────────────────────────────────────────────────────────────
// engine/analysis/pitch.test — YIN fundamental / note detection
// ─────────────────────────────────────────────────────────────
// Synthetic tones of known frequency must round-trip to the right note, octave
// and cents; broadband noise must read as low-confidence; a chirp's contour
// must rise over time.

import { describe, expect, it } from "vitest";
import { fromChannels } from "../audio/buffer";
import { sine, chirp } from "../generate/tone";
import { whiteNoise } from "../generate/noise";
import { detectPitch, hzToNote, pitchContour } from "./pitch";

const SR = 44100;

describe("detectPitch", () => {
  it("reads a 440 Hz tone as A4, 0 cents, high confidence", () => {
    const r = detectPitch(sine(440, 0.5, { sampleRate: SR, amplitude: 0.6 }));
    expect(r.hz).toBeGreaterThan(437);
    expect(r.hz).toBeLessThan(443);
    expect(r.note).toBe("A");
    expect(r.octave).toBe(4);
    expect(Math.abs(r.cents)).toBeLessThan(10);
    expect(r.confidence).toBeGreaterThan(0.8);
  });

  it("reads 220 Hz as A3 and 110 Hz as A2 (octaves)", () => {
    const a3 = detectPitch(sine(220, 0.5, { sampleRate: SR, amplitude: 0.6 }));
    expect(a3.note).toBe("A");
    expect(a3.octave).toBe(3);
    expect(a3.hz).toBeGreaterThan(218);
    expect(a3.hz).toBeLessThan(222);
    const a2 = detectPitch(sine(110, 0.5, { sampleRate: SR, amplitude: 0.6 }));
    expect(a2.note).toBe("A");
    expect(a2.octave).toBe(2);
  });

  it("reads middle C (261.63 Hz) as C4", () => {
    const r = detectPitch(sine(261.63, 0.5, { sampleRate: SR, amplitude: 0.6 }));
    expect(r.note).toBe("C");
    expect(r.octave).toBe(4);
    expect(Math.abs(r.cents)).toBeLessThan(15);
  });

  it("reports a slightly sharp tone as positive cents", () => {
    // 444 Hz is ~+16 cents above A4.
    const r = detectPitch(sine(444, 0.5, { sampleRate: SR, amplitude: 0.6 }));
    expect(r.note).toBe("A");
    expect(r.cents).toBeGreaterThan(5);
  });

  it("gives broadband noise a low confidence", () => {
    const r = detectPitch(whiteNoise(0.5, { sampleRate: SR, amplitude: 0.5, seed: 3 }));
    expect(r.confidence).toBeLessThan(0.5);
  });

  it("returns no pitch for too-short input", () => {
    const r = detectPitch(fromChannels([new Float32Array(64)], SR));
    expect(r.hz).toBe(0);
    expect(r.note).toBe("");
  });

  it("works on a stereo tone", () => {
    const ch = sine(330, 0.5, { sampleRate: SR, amplitude: 0.6 }).channels[0]; // E4
    const r = detectPitch(fromChannels([ch, ch], SR));
    expect(r.note).toBe("E");
    expect(r.octave).toBe(4);
  });
});

describe("hzToNote", () => {
  it("maps the reference pitches", () => {
    expect(hzToNote(440)).toEqual({ note: "A", octave: 4, cents: 0 });
    expect(hzToNote(261.63).note).toBe("C");
    expect(hzToNote(261.63).octave).toBe(4);
    expect(hzToNote(0)).toEqual({ note: "", octave: 0, cents: 0 });
  });
});

describe("pitchContour", () => {
  it("rises over time for an ascending chirp", () => {
    const c = pitchContour(chirp(200, 800, 1.0, { sampleRate: SR, amplitude: 0.6 }));
    expect(c.hz.length).toBeGreaterThan(4);
    expect(c.times.length).toBe(c.hz.length);
    const confident = c.hz.filter((_, i) => c.confidence[i] > 0.7);
    expect(confident.length).toBeGreaterThan(3);
    // first confident reading clearly below the last
    const firstIdx = c.confidence.findIndex((v) => v > 0.7);
    let lastIdx = -1;
    for (let i = c.confidence.length - 1; i >= 0; i--) if (c.confidence[i] > 0.7) { lastIdx = i; break; }
    expect(c.hz[lastIdx]).toBeGreaterThan(c.hz[firstIdx] + 100);
  });
});
