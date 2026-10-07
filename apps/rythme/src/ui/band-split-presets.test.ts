// ─────────────────────────────────────────────────────────────
// ui/band-split-presets.test — the shipped Frequency Band Splitter presets
// ─────────────────────────────────────────────────────────────
// Drives each BAND_SPLIT_PRESETS crossover set through the engine, proving the
// promised band count and that the bands still recombine exactly.

import { describe, expect, it } from "vitest";
import * as E from "../engine";
import { BAND_SPLIT_PRESETS } from "./commands";

const SR = 44100;

const noise = () => E.Generate.whiteNoise(0.2, { sampleRate: SR, amplitude: 0.5, seed: 5, channels: 1 });

const opts = (id: string) => BAND_SPLIT_PRESETS.find((p) => p.id === id)!.crossovers;

function reconstructionError(input: E.AudioData, bands: E.AudioData[]): number {
  const x = input.channels[0];
  let maxErr = 0;
  for (let i = 0; i < x.length; i++) {
    let sum = 0;
    for (const b of bands) sum += b.channels[0][i];
    maxErr = Math.max(maxErr, Math.abs(sum - x[i]));
  }
  return maxErr;
}

describe("BAND_SPLIT_PRESETS", () => {
  it("exposes the four named presets", () => {
    expect(BAND_SPLIT_PRESETS.map((p) => p.label)).toEqual([
      "2-Band (1 kHz)",
      "3-Band (800 · 3.2k)",
      "4-Band",
      "5-Band",
    ]);
  });

  it("each preset produces crossovers+1 bands that recombine exactly", () => {
    const x = noise();
    for (const p of BAND_SPLIT_PRESETS) {
      const bands = E.DSP.frequencyBandSplit(x, { crossovers: p.crossovers });
      expect(bands).toHaveLength(p.crossovers.length + 1);
      expect(reconstructionError(x, bands)).toBeLessThan(1e-5);
    }
  });

  it("the 3-band preset matches Audition's 800 / 3200 default", () => {
    expect(opts("bs3")).toEqual([800, 3200]);
  });
});
