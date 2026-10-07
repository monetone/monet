// ─────────────────────────────────────────────────────────────
// engine/dsp/delay.test — clean feedback delay
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { createAudioData } from "../audio/buffer";
import { frameCount, type AudioData } from "../audio/types";
import { sine } from "../generate/tone";
import { delay } from "./delay";

const SR = 44100;

function segmentMaxAbsDiff(a: AudioData, b: AudioData, startSeconds: number, endSeconds: number): number {
  const start = Math.max(0, Math.round(startSeconds * a.sampleRate));
  const end = Math.min(frameCount(a), frameCount(b), Math.round(endSeconds * a.sampleRate));
  let m = 0;
  const channels = Math.min(a.channels.length, b.channels.length);
  for (let c = 0; c < channels; c++) {
    for (let i = start; i < end; i++) m = Math.max(m, Math.abs(a.channels[c][i] - b.channels[c][i]));
  }
  return m;
}

describe("delay", () => {
  it("applies mix automation as a time-varying dry/wet blend", () => {
    const input = sine(440, 1, { sampleRate: SR, amplitude: 0.3 });
    const dry = delay(input, { delayMs: 50, feedback: 0.35, mix: 0, tailSeconds: 0.2 });
    const wet = delay(input, { delayMs: 50, feedback: 0.35, mix: 1, tailSeconds: 0.2 });
    const out = delay(input, {
      delayMs: 50,
      feedback: 0.35,
      mix: 0,
      tailSeconds: 0.2,
      automation: { mix: (time) => (time < 0.5 ? 0 : 1) },
    });

    expect(segmentMaxAbsDiff(out, dry, 0.1, 0.45)).toBeLessThan(1e-6);
    expect(segmentMaxAbsDiff(out, wet, 0.65, 0.95)).toBeLessThan(1e-6);
    expect(segmentMaxAbsDiff(dry, wet, 0.65, 0.95)).toBeGreaterThan(0.02);
  });

  it("applies feedback automation to future repeats", () => {
    const input = createAudioData(1, 1, 1000);
    input.channels[0][0] = 1;
    const out = delay(input, {
      delayMs: 100,
      feedback: 0,
      mix: 1,
      tailSeconds: 0.35,
      automation: { feedback: (time) => (time < 0.05 ? 0 : 0.5) },
    });

    expect(out.channels[0][100]).toBeCloseTo(1, 6);
    expect(out.channels[0][200]).toBeCloseTo(0.5, 6);
    expect(out.channels[0][300]).toBeCloseTo(0.25, 6);
  });

  it("matches static delay time when delay automation is constant", () => {
    const input = createAudioData(1, 1, 1000);
    input.channels[0][0] = 1;
    const staticOut = delay(input, { delayMs: 100, feedback: 0.5, mix: 1, tailSeconds: 0.35 });
    const autoOut = delay(input, {
      delayMs: 10,
      feedback: 0.5,
      mix: 1,
      tailSeconds: 0.35,
      automation: { delayMs: () => 100 },
    });

    expect(segmentMaxAbsDiff(autoOut, staticOut, 0, 0.35)).toBeLessThan(1e-6);
  });

  it("applies delay time automation to future repeats", () => {
    const input = createAudioData(1, 1, 1000);
    input.channels[0][0] = 1;
    const out = delay(input, {
      delayMs: 100,
      feedback: 0.5,
      mix: 1,
      tailSeconds: 0.25,
      automation: { delayMs: (time) => (time < 0.12 ? 100 : 50) },
    });

    expect(out.channels[0][100]).toBeCloseTo(1, 6);
    expect(out.channels[0][150]).toBeCloseTo(0.5, 6);
    expect(out.channels[0][200]).toBeCloseTo(0.25, 6);
  });
});
