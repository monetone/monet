import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { frameCount } from "../audio/types";
import { magnitudes } from "../analysis/fft";
import { peakAmplitude } from "../dsp/normalize";
import { decodeAudio } from "./import";

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "test-assets");

interface FixtureMeta {
  name: string;
  bytes: number;
  freq?: number;
  ch: number;
  sr: number;
}

const manifest: FixtureMeta[] = JSON.parse(readFileSync(join(ASSETS, "manifest.json"), "utf8"));

/** Dominant frequency of a channel via FFT peak bin. */
function dominantFreq(samples: Float32Array, sampleRate: number): number {
  const fftSize = 8192;
  const mag = magnitudes(samples.subarray(0, fftSize), fftSize);
  let peak = 1;
  for (let i = 2; i < mag.length; i++) if (mag[i] > mag[peak]) peak = i;
  return (peak * sampleRate) / fftSize;
}

describe("decoding externally-authored WAV fixtures", () => {
  it("has a fixtures manifest (run `pnpm fixtures` to regenerate)", () => {
    expect(manifest.length).toBeGreaterThanOrEqual(8);
  });

  for (const fx of manifest) {
    it(`decodes ${fx.name}`, () => {
      const bytes = new Uint8Array(readFileSync(join(ASSETS, fx.name)));
      const audio = decodeAudio(bytes, fx.name);
      expect(audio.sampleRate).toBe(fx.sr);
      expect(audio.channels.length).toBe(fx.ch);
      expect(frameCount(audio)).toBeGreaterThan(0);
      expect(peakAmplitude(audio)).toBeGreaterThan(0.2);
      expect(peakAmplitude(audio)).toBeLessThanOrEqual(1.0001);
      if (fx.freq) {
        expect(dominantFreq(audio.channels[0], audio.sampleRate)).toBeCloseTo(fx.freq, -1.6);
      }
    });
  }

  it("skips unknown chunks (fact / LIST) before the data chunk", () => {
    const bytes = new Uint8Array(readFileSync(join(ASSETS, "tone-extrachunks-16.wav")));
    const audio = decodeAudio(bytes, "tone-extrachunks-16.wav");
    expect(frameCount(audio)).toBeGreaterThan(0);
    expect(dominantFreq(audio.channels[0], audio.sampleRate)).toBeCloseTo(440, -1.6);
  });

  it("decodes 24-bit and 32-bit-float fixtures to the same tone", () => {
    const b24 = decodeAudio(new Uint8Array(readFileSync(join(ASSETS, "tone-1k-24.wav"))), "tone-1k-24.wav");
    const b32 = decodeAudio(new Uint8Array(readFileSync(join(ASSETS, "tone-1k-32f.wav"))), "tone-1k-32f.wav");
    expect(dominantFreq(b24.channels[0], b24.sampleRate)).toBeCloseTo(1000, -1.6);
    expect(dominantFreq(b32.channels[0], b32.sampleRate)).toBeCloseTo(1000, -1.6);
  });
});
