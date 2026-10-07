import { describe, expect, it } from "vitest";
import { channelCount, durationSeconds, frameCount } from "../audio/types";
import { peakAmplitude, rmsAmplitude } from "../dsp/normalize";
import { chirp, dtmf, DTMF_FREQS, sine, square, triangle } from "./tone";

describe("tone generators", () => {
  it("sine has the requested amplitude, length and channels", () => {
    const d = sine(440, 0.5, { sampleRate: 48000, amplitude: 0.8, channels: 2 });
    expect(channelCount(d)).toBe(2);
    expect(frameCount(d)).toBe(24000);
    expect(durationSeconds(d)).toBeCloseTo(0.5);
    expect(peakAmplitude(d)).toBeCloseTo(0.8, 2);
  });

  it("sine RMS ≈ amplitude / √2", () => {
    const d = sine(1000, 1, { sampleRate: 48000, amplitude: 1 });
    expect(rmsAmplitude(d)).toBeCloseTo(Math.SQRT1_2, 2);
  });

  it("is deterministic", () => {
    const a = sine(440, 0.01);
    const b = sine(440, 0.01);
    expect(Array.from(a.channels[0])).toEqual(Array.from(b.channels[0]));
  });

  it("square is bipolar full-swing; triangle stays within range", () => {
    const sq = square(100, 0.05, { amplitude: 0.9 });
    expect(peakAmplitude(sq)).toBeCloseTo(0.9, 5);
    const tr = triangle(100, 0.05, { amplitude: 0.5 });
    expect(peakAmplitude(tr)).toBeLessThanOrEqual(0.5 + 1e-6);
  });

  it("chirp is continuous (no large sample-to-sample jumps)", () => {
    const c = chirp(100, 2000, 0.2, { sampleRate: 48000 });
    const ch = c.channels[0];
    let maxJump = 0;
    for (let i = 1; i < ch.length; i++) maxJump = Math.max(maxJump, Math.abs(ch[i] - ch[i - 1]));
    expect(maxJump).toBeLessThan(0.5);
  });

  it("dtmf mixes both row/column tones", () => {
    const key = "5";
    const d = dtmf(key, 0.1, { sampleRate: 8000 });
    expect(DTMF_FREQS[key]).toEqual([770, 1336]);
    expect(peakAmplitude(d)).toBeGreaterThan(0);
    expect(frameCount(d)).toBe(800);
  });

  it("dtmf rejects unknown keys", () => {
    expect(() => dtmf("Z")).toThrow(/unknown key/);
  });
});
