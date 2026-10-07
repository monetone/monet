import { describe, expect, it } from "vitest";
import { audioBufferToAudioData, browserAudioDecodeSupported } from "./decode";

describe("browser audio decode helpers", () => {
  it("copies an AudioBuffer into planar AudioData", () => {
    const left = Float32Array.from([0.1, 0.2]);
    const right = Float32Array.from([-0.1, -0.2]);
    const buffer = {
      sampleRate: 48000,
      numberOfChannels: 2,
      getChannelData: (channel: number) => (channel === 0 ? left : right),
    } as AudioBuffer;

    const audio = audioBufferToAudioData(buffer);
    expect(audio.sampleRate).toBe(48000);
    expect(audio.channels).toHaveLength(2);
    expect(Array.from(audio.channels[0], (v) => Number(v.toFixed(3)))).toEqual([0.1, 0.2]);
    expect(Array.from(audio.channels[1], (v) => Number(v.toFixed(3)))).toEqual([-0.1, -0.2]);
    expect(audio.channels[0]).not.toBe(left);
  });

  it("reports unsupported when no browser AudioContext exists", () => {
    expect(browserAudioDecodeSupported()).toBe(false);
  });
});
