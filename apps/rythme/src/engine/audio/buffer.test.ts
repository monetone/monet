import { describe, expect, it } from "vitest";
import {
  concat,
  createAudioData,
  deinterleave,
  fromChannels,
  interleave,
  mixToMono,
  resampleLinear,
  setChannelCount,
  sliceFrames,
} from "./buffer";
import { channelCount, durationSeconds, frameCount } from "./types";

describe("buffer primitives", () => {
  it("creates a silent buffer of the right shape", () => {
    const d = createAudioData(2, 100, 48000);
    expect(channelCount(d)).toBe(2);
    expect(frameCount(d)).toBe(100);
    expect(durationSeconds(d)).toBeCloseTo(100 / 48000);
    expect(d.channels[0].every((s) => s === 0)).toBe(true);
  });

  it("slices a half-open frame range, clamped", () => {
    const d = fromChannels([[0, 1, 2, 3, 4, 5]], 8);
    expect(Array.from(sliceFrames(d, 1, 4).channels[0])).toEqual([1, 2, 3]);
    expect(frameCount(sliceFrames(d, 4, 1))).toBe(0); // inverted ⇒ empty
    expect(Array.from(sliceFrames(d, -5, 99).channels[0])).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("concatenates buffers end to end", () => {
    const a = fromChannels([[1, 2]], 8);
    const b = fromChannels([[3, 4, 5]], 8);
    expect(Array.from(concat(a, b).channels[0])).toEqual([1, 2, 3, 4, 5]);
  });

  it("rejects sample-rate mismatch on concat", () => {
    expect(() => concat(fromChannels([[1]], 8), fromChannels([[2]], 16))).toThrow(/mismatch/);
  });

  it("up-mixes mono→stereo by duplication and down-mixes by average", () => {
    const mono = fromChannels([[1, -1, 0.5]], 8);
    const st = setChannelCount(mono, 2);
    expect(Array.from(st.channels[0])).toEqual([1, -1, 0.5]);
    expect(Array.from(st.channels[1])).toEqual([1, -1, 0.5]);

    const stereo = fromChannels(
      [
        [1, 0],
        [0, 1],
      ],
      8,
    );
    expect(Array.from(mixToMono(stereo).channels[0])).toEqual([0.5, 0.5]);
  });

  it("round-trips interleave/deinterleave", () => {
    const d = fromChannels(
      [
        [1, 2, 3],
        [4, 5, 6],
      ],
      8,
    );
    const il = interleave(d);
    expect(Array.from(il)).toEqual([1, 4, 2, 5, 3, 6]);
    const back = deinterleave(il, 2, 8);
    expect(Array.from(back.channels[0])).toEqual([1, 2, 3]);
    expect(Array.from(back.channels[1])).toEqual([4, 5, 6]);
  });

  it("resamples linearly preserving duration and endpoints", () => {
    const d = fromChannels([[0, 1, 0, -1]], 4); // 1s at 4 Hz
    const up = resampleLinear(d, 8);
    expect(up.sampleRate).toBe(8);
    expect(frameCount(up)).toBe(8);
    expect(durationSeconds(up)).toBeCloseTo(durationSeconds(d), 5);
    expect(up.channels[0][0]).toBeCloseTo(0); // first sample preserved
  });

  it("resample is identity at the same rate", () => {
    const d = fromChannels([[0.1, 0.2]], 8);
    const out = resampleLinear(d, 8);
    expect(out.channels[0][0]).toBeCloseTo(0.1, 6);
    expect(out.channels[0][1]).toBeCloseTo(0.2, 6);
  });
});
