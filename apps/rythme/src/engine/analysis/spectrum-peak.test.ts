// ─────────────────────────────────────────────────────────────
// engine/analysis/spectrum-peak.test — Frequency Analysis peak-hold ("Hold")
// ─────────────────────────────────────────────────────────────
// The averaged spectrum (db) is the "Scan" curve; peakDb is the "Hold" curve —
// the loudest each bin ever got. For a sweep, every bin in the swept range was
// loud in some frame but quiet on average, so peak-hold sits far above the
// average; for a steady tone they agree at the tone's bin.

import { describe, expect, it } from "vitest";
import { sine, chirp } from "../generate/tone";
import { spectrum } from "./spectrum";

const SR = 44100;

/** Nearest bin index to a frequency. */
const binOf = (s: ReturnType<typeof spectrum>, hz: number) => Math.round((hz * s.fftSize) / SR);

describe("spectrum peak-hold (Hold)", () => {
  it("peak-hold is never below the average, in every bin", () => {
    const s = spectrum(chirp(200, 6000, 0.5, { sampleRate: SR, amplitude: 0.6 }), { fftSize: 2048 });
    expect(s.peakDb).toHaveLength(s.db.length);
    for (let i = 0; i < s.db.length; i++) expect(s.peakDb[i]).toBeGreaterThanOrEqual(s.db[i] - 1e-6);
  });

  it("for a sweep, peak-hold sits far above the average across the swept range", () => {
    const s = spectrum(chirp(300, 5000, 0.6, { sampleRate: SR, amplitude: 0.6 }), { fftSize: 2048 });
    for (const hz of [500, 1000, 2000, 4000]) {
      const i = binOf(s, hz);
      expect(s.peakDb[i]).toBeGreaterThan(s.db[i] + 10); // each freq is brief → average is much lower
    }
  });

  it("for a steady tone, peak-hold ≈ average at the tone's bin", () => {
    const s = spectrum(sine(1000, 1, { sampleRate: SR, amplitude: 0.7 }), { fftSize: 4096 });
    const i = binOf(s, 1000);
    expect(s.peakDb[i]).toBeGreaterThan(-10); // the tone is clearly present (well above the floor)
    expect(Math.abs(s.peakDb[i] - s.db[i])).toBeLessThan(2); // loud in every frame → peak ≈ average
  });
});
