import { describe, expect, it } from "vitest";
import { frameCount } from "../engine";
import { chunksToAudioData, measurePcmChunkLevel, recordingSupported } from "./recording";

describe("recording PCM conversion", () => {
  it("concatenates captured Float32 chunks channel-by-channel", () => {
    const audio = chunksToAudioData(
      [
        { channels: [Float32Array.from([0.1, 0.2]), Float32Array.from([-0.1, -0.2])] },
        { channels: [Float32Array.from([0.3]), Float32Array.from([-0.3])] },
      ],
      48000,
      2,
    );
    expect(audio.sampleRate).toBe(48000);
    expect(frameCount(audio)).toBe(3);
    expect(rounded(audio.channels[0])).toEqual([0.1, 0.2, 0.3]);
    expect(rounded(audio.channels[1])).toEqual([-0.1, -0.2, -0.3]);
  });

  it("duplicates mono chunks when a stereo recording target is requested", () => {
    const audio = chunksToAudioData([{ channels: [Float32Array.from([0.4, 0.5])] }], 44100, 2);
    expect(audio.channels).toHaveLength(2);
    expect(rounded(audio.channels[0])).toEqual([0.4, 0.5]);
    expect(rounded(audio.channels[1])).toEqual([0.4, 0.5]);
  });

  it("reports unsupported when browser recording APIs are absent", () => {
    expect(recordingSupported()).toBe(false);
  });

  it("measures peak, rms, and clipping for live input metering", () => {
    const level = measurePcmChunkLevel({
      channels: [Float32Array.from([-1, 0.5]), Float32Array.from([0.25, -0.25])],
    });

    expect(level.channels).toBe(2);
    expect(level.peak).toBe(1);
    expect(level.rms).toBeCloseTo(Math.sqrt(1.375 / 4), 6);
    expect(level.peakDb).toBeCloseTo(0, 6);
    expect(level.rmsDb).toBeCloseTo(20 * Math.log10(Math.sqrt(1.375 / 4)), 6);
    expect(level.clipped).toBe(true);
  });
});

function rounded(values: Float32Array): number[] {
  return Array.from(values, (value) => Number(value.toFixed(3)));
}
