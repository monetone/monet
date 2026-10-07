// ─────────────────────────────────────────────────────────────
// engine/analysis/histogram.test — amplitude distribution (dBFS)
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { gainToDb } from "../audio/db";
import { square, sine } from "../generate/tone";
import { generateSilence } from "../generate/silence";
import { frameCount } from "../audio/types";
import { amplitudeHistogram } from "./histogram";

const SR = 44100;

describe("amplitudeHistogram", () => {
  it("a square wave lands almost entirely in one bin (its |amplitude| in dBFS)", () => {
    const sq = square(200, 0.2, { sampleRate: SR, amplitude: 0.5 });
    const h = amplitudeHistogram(sq, { binDb: 1 });
    expect(h.peakBinDb).toBeCloseTo(gainToDb(0.5), 0); // ≈ −6 dBFS
    // the modal bin holds the vast majority of samples (only the edges differ)
    const modal = Math.max(...h.counts);
    expect(modal / h.total).toBeGreaterThan(0.95);
  });

  it("a louder signal's modal bin sits higher than a quieter one's", () => {
    const loud = amplitudeHistogram(square(200, 0.2, { sampleRate: SR, amplitude: 0.8 }), { binDb: 1 });
    const quiet = amplitudeHistogram(square(200, 0.2, { sampleRate: SR, amplitude: 0.2 }), { binDb: 1 });
    expect(loud.peakBinDb).toBeGreaterThan(quiet.peakBinDb);
    expect(loud.peakBinDb).toBeCloseTo(gainToDb(0.8), 0); // ≈ −1.9 dBFS
    expect(quiet.peakBinDb).toBeCloseTo(gainToDb(0.2), 0); // ≈ −14 dBFS
  });

  it("silence falls in the lowest (floor) bin", () => {
    const h = amplitudeHistogram(generateSilence(0.1, 2, SR), { minDb: -100, binDb: 1 });
    expect(h.peakBinDb).toBeCloseTo(-99.5, 1); // minDb + binDb/2
    expect(h.counts[0]).toBe(h.total); // everything in the floor bin
  });

  it("tallies every sample across all channels", () => {
    const d = sine(440, 0.1, { sampleRate: SR, amplitude: 0.6, channels: 2 });
    const h = amplitudeHistogram(d);
    expect(h.total).toBe(frameCount(d) * 2);
    expect(h.counts.reduce((a, b) => a + b, 0)).toBe(h.total);
  });

  it("a sine spreads across more bins than a square at the same amplitude", () => {
    const occupied = (counts: number[]) => counts.filter((c) => c > 0).length;
    const sineH = amplitudeHistogram(sine(440, 0.2, { sampleRate: SR, amplitude: 0.5 }), { binDb: 1 });
    const squareH = amplitudeHistogram(square(440, 0.2, { sampleRate: SR, amplitude: 0.5 }), { binDb: 1 });
    expect(occupied(sineH.counts)).toBeGreaterThan(occupied(squareH.counts));
  });

  it("respects the bin width and returns ascending bin centres", () => {
    const h = amplitudeHistogram(sine(440, 0.05, { sampleRate: SR, amplitude: 0.5 }), { minDb: -60, binDb: 3 });
    expect(h.binsDb).toHaveLength(20); // 60 / 3
    expect(h.binsDb[0]).toBeCloseTo(-58.5, 6); // -60 + 1.5
    for (let i = 1; i < h.binsDb.length; i++) expect(h.binsDb[i]).toBeGreaterThan(h.binsDb[i - 1]);
  });
});
