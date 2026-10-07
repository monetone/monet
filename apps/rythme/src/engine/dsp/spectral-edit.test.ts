// ─────────────────────────────────────────────────────────────
// engine/dsp/spectral-edit.test — Spectral Frequency Display edits
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { createAudioData, sliceFrames } from "../audio/buffer";
import { channelCount, frameCount, type AudioData } from "../audio/types";
import { spectrum } from "../analysis/spectrum";
import { sine } from "../generate/tone";
import { spectralBrushGain, spectralGain, spectralHarmonicGain } from "./spectral-edit";

const SR = 44100;

function mixedTone(seconds = 0.5): AudioData {
  const low = sine(500, seconds, { sampleRate: SR, amplitude: 0.35, channels: 1 });
  const high = sine(4000, seconds, { sampleRate: SR, amplitude: 0.35, channels: 1 });
  const out = createAudioData(1, frameCount(low), SR);
  for (let i = 0; i < frameCount(out); i++) out.channels[0][i] = low.channels[0][i] + high.channels[0][i];
  return out;
}

function brushTone(seconds = 1): AudioData {
  const low = sine(500, seconds, { sampleRate: SR, amplitude: 0.25, channels: 1 });
  const center = sine(4000, seconds, { sampleRate: SR, amplitude: 0.25, channels: 1 });
  const edge = sine(4400, seconds, { sampleRate: SR, amplitude: 0.25, channels: 1 });
  const out = createAudioData(1, frameCount(low), SR);
  for (let i = 0; i < frameCount(out); i++) out.channels[0][i] = low.channels[0][i] + center.channels[0][i] + edge.channels[0][i];
  return out;
}

function harmonicTone(seconds = 0.75): AudioData {
  const tones = [
    sine(440, seconds, { sampleRate: SR, amplitude: 0.2, channels: 1 }),
    sine(880, seconds, { sampleRate: SR, amplitude: 0.2, channels: 1 }),
    sine(1320, seconds, { sampleRate: SR, amplitude: 0.2, channels: 1 }),
    sine(3000, seconds, { sampleRate: SR, amplitude: 0.2, channels: 1 }),
  ];
  const out = createAudioData(1, frameCount(tones[0]), SR);
  for (let i = 0; i < frameCount(out); i++) {
    for (const tone of tones) out.channels[0][i] += tone.channels[0][i];
  }
  return out;
}

function binDb(d: AudioData, hz: number): number {
  const spec = spectrum(d, { fftSize: 4096, window: "hann" });
  let best = 0;
  for (let i = 1; i < spec.freqs.length; i++) if (Math.abs(spec.freqs[i] - hz) < Math.abs(spec.freqs[best] - hz)) best = i;
  return spec.db[best];
}

function segmentBinDb(d: AudioData, hz: number, startSeconds: number, endSeconds: number): number {
  return binDb(sliceFrames(d, Math.round(startSeconds * d.sampleRate), Math.round(endSeconds * d.sampleRate)), hz);
}

describe("spectralGain", () => {
  it("attenuates only the selected frequency band", () => {
    const input = mixedTone();
    const out = spectralGain(input, { minHz: 3500, maxHz: 4500, gainDb: -48, fftSize: 4096, transitionHz: 20 });

    expect(frameCount(out)).toBe(frameCount(input));
    expect(channelCount(out)).toBe(1);
    expect(binDb(out, 4000)).toBeLessThan(binDb(input, 4000) - 20);
    expect(Math.abs(binDb(out, 500) - binDb(input, 500))).toBeLessThan(2);
  });

  it("can target one stereo side without mutating the input", () => {
    const left = sine(4000, 0.25, { sampleRate: SR, amplitude: 0.5, channels: 1 });
    const right = sine(4000, 0.25, { sampleRate: SR, amplitude: 0.5, channels: 1 });
    const stereo = createAudioData(2, frameCount(left), SR);
    stereo.channels[0].set(left.channels[0]);
    stereo.channels[1].set(right.channels[0]);
    const originalRight = Array.from(stereo.channels[1]);

    const out = spectralGain(stereo, { minHz: 3500, maxHz: 4500, gainDb: -48, channel: "left" });

    expect(binDb({ sampleRate: SR, channels: [out.channels[0]] }, 4000)).toBeLessThan(
      binDb({ sampleRate: SR, channels: [stereo.channels[0]] }, 4000) - 20,
    );
    expect(Array.from(out.channels[1])).toEqual(originalRight);
    expect(Array.from(stereo.channels[1])).toEqual(originalRight);
  });
});

describe("spectralBrushGain", () => {
  it("attenuates the selected band strongest at the brush center while preserving time and frequency edges", () => {
    const input = brushTone(1);
    const out = spectralBrushGain(input, { minHz: 3500, maxHz: 4500, gainDb: -60, fftSize: 4096, transitionHz: 20 });

    expect(frameCount(out)).toBe(frameCount(input));
    expect(segmentBinDb(out, 4000, 0.45, 0.55)).toBeLessThan(segmentBinDb(input, 4000, 0.45, 0.55) - 15);
    expect(Math.abs(segmentBinDb(out, 4000, 0, 0.1) - segmentBinDb(input, 4000, 0, 0.1))).toBeLessThan(5);
    expect(Math.abs(segmentBinDb(out, 4400, 0.45, 0.55) - segmentBinDb(input, 4400, 0.45, 0.55))).toBeLessThan(6);
    expect(Math.abs(segmentBinDb(out, 500, 0.45, 0.55) - segmentBinDb(input, 500, 0.45, 0.55))).toBeLessThan(3);
  });
});

describe("spectralHarmonicGain", () => {
  it("attenuates a fundamental and integer harmonics while preserving off-harmonic audio", () => {
    const input = harmonicTone();
    const out = spectralHarmonicGain(input, {
      fundamentalHz: 440,
      bandwidthHz: 80,
      harmonics: 3,
      gainDb: -48,
      fftSize: 4096,
      transitionHz: 20,
    });

    expect(frameCount(out)).toBe(frameCount(input));
    expect(binDb(out, 440)).toBeLessThan(binDb(input, 440) - 15);
    expect(binDb(out, 880)).toBeLessThan(binDb(input, 880) - 15);
    expect(binDb(out, 1320)).toBeLessThan(binDb(input, 1320) - 15);
    expect(Math.abs(binDb(out, 3000) - binDb(input, 3000))).toBeLessThan(3);
  });
});
