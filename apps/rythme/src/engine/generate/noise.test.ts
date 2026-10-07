import { describe, expect, it } from "vitest";
import { peakAmplitude, rmsAmplitude } from "../dsp/normalize";
import { brownNoise, pinkNoise, whiteNoise } from "./noise";

describe("noise generators", () => {
  it("white noise is reproducible for a fixed seed", () => {
    const a = whiteNoise(0.1, { seed: 42 });
    const b = whiteNoise(0.1, { seed: 42 });
    const c = whiteNoise(0.1, { seed: 7 });
    expect(Array.from(a.channels[0])).toEqual(Array.from(b.channels[0]));
    expect(Array.from(a.channels[0])).not.toEqual(Array.from(c.channels[0]));
  });

  it("white noise stays within amplitude and has energy", () => {
    const d = whiteNoise(0.2, { amplitude: 0.5, seed: 1 });
    expect(peakAmplitude(d)).toBeLessThanOrEqual(0.5 + 1e-6);
    expect(rmsAmplitude(d)).toBeGreaterThan(0.1);
  });

  it("pink and brown noise produce bounded, non-trivial signals", () => {
    const pink = pinkNoise(0.2, { seed: 2, amplitude: 0.5 });
    const brown = brownNoise(0.2, { seed: 2, amplitude: 0.5 });
    expect(rmsAmplitude(pink)).toBeGreaterThan(0);
    expect(rmsAmplitude(brown)).toBeGreaterThan(0);
    expect(peakAmplitude(pink)).toBeLessThanOrEqual(1.0);
    expect(peakAmplitude(brown)).toBeLessThanOrEqual(1.0);
  });
});
