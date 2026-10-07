// ─────────────────────────────────────────────────────────────
// dsp/basic.test — Swap Channels (Adobe Audition parity) + polarity
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import type { AudioData } from "../audio/types";
import { invertPolarity, swapStereo } from "./basic";

const stereo = (l: number[], r: number[]): AudioData => ({ sampleRate: 48000, channels: [Float32Array.from(l), Float32Array.from(r)] });
const mono = (c: number[]): AudioData => ({ sampleRate: 48000, channels: [Float32Array.from(c)] });

describe("swapStereo", () => {
  it("swaps the left and right channels", () => {
    const d = stereo([1, 2, 3], [4, 5, 6]);
    const out = swapStereo(d);
    expect(Array.from(out.channels[0])).toEqual([4, 5, 6]); // L ← old R
    expect(Array.from(out.channels[1])).toEqual([1, 2, 3]); // R ← old L
  });

  it("does not mutate the input (returns fresh channel buffers)", () => {
    const d = stereo([1, 2], [3, 4]);
    const out = swapStereo(d);
    expect(Array.from(d.channels[0])).toEqual([1, 2]); // original untouched
    expect(out.channels[0]).not.toBe(d.channels[1]); // copied, not aliased
  });

  it("leaves a mono signal unchanged (channel count ≠ 2)", () => {
    const d = mono([1, 2, 3]);
    const out = swapStereo(d);
    expect(out.channels).toHaveLength(1);
    expect(Array.from(out.channels[0])).toEqual([1, 2, 3]);
  });

  it("is its own inverse (swapping twice restores the original)", () => {
    const d = stereo([1, 2, 3], [4, 5, 6]);
    const back = swapStereo(swapStereo(d));
    expect(Array.from(back.channels[0])).toEqual([1, 2, 3]);
    expect(Array.from(back.channels[1])).toEqual([4, 5, 6]);
  });
});

describe("invertPolarity", () => {
  it("negates every sample (and is its own inverse)", () => {
    const d = stereo([0.5, -0.25], [1, -1]);
    const inv = invertPolarity(d);
    expect(Array.from(inv.channels[0])).toEqual([-0.5, 0.25]);
    expect(Array.from(invertPolarity(inv).channels[0])).toEqual([0.5, -0.25]);
  });
});
