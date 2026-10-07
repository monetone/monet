// ─────────────────────────────────────────────────────────────
// dsp/remix.test — duration-targeted Remix processor
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { createAudioData } from "../audio/buffer";
import { durationSeconds, frameCount } from "../audio/types";
import { remixToDuration } from "./remix";

const SR = 1000;

function ramp(seconds: number) {
  const frames = Math.round(seconds * SR);
  const audio = createAudioData(2, frames, SR);
  for (let i = 0; i < frames; i++) {
    audio.channels[0][i] = i / frames;
    audio.channels[1][i] = -i / frames;
  }
  return audio;
}

function allFinite(values: Float32Array): boolean {
  return values.every((v) => Number.isFinite(v));
}

describe("remixToDuration", () => {
  it("shortens to the exact target duration and crossfades into the tail", () => {
    const out = remixToDuration(ramp(1), 0.5, { crossfadeMs: 100 });
    expect(frameCount(out)).toBe(500);
    expect(durationSeconds(out)).toBeCloseTo(0.5, 6);
    expect(out.channels[0][499]).toBeGreaterThan(0.8);
  });

  it("extends to the exact target duration by looping with finite crossfades", () => {
    const out = remixToDuration(ramp(0.4), 1.1, { crossfadeMs: 50 });
    expect(frameCount(out)).toBe(1100);
    expect(out.channels).toHaveLength(2);
    expect(allFinite(out.channels[0])).toBe(true);
    expect(allFinite(out.channels[1])).toBe(true);
  });

  it("handles zero and unchanged targets without mutating the input", () => {
    const src = ramp(0.25);
    const same = remixToDuration(src, 0.25);
    expect(same).not.toBe(src);
    expect(same.channels[0]).not.toBe(src.channels[0]);
    expect(frameCount(remixToDuration(src, 0))).toBe(0);
    expect(frameCount(remixToDuration(createAudioData(1, 0, SR), 1))).toBe(1000);
  });
});
