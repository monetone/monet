// ─────────────────────────────────────────────────────────────
// ui/scientific-filter-presets.test — the shipped Scientific Filter presets
// ─────────────────────────────────────────────────────────────
// Drives the actual SCIENTIFIC_FILTER_PRESETS objects through the engine so each
// named preset provably passes its passband and rejects its stopband.

import { describe, expect, it } from "vitest";
import * as E from "../engine";
import { SCIENTIFIC_FILTER_PRESETS } from "./commands";

const SR = 44100;

const tone = (freq: number) => E.Generate.sine(freq, 0.4, { sampleRate: SR, amplitude: 0.5 });

function settledRms(ch: Float32Array): number {
  let sum = 0;
  const start = ch.length >> 1;
  for (let i = start; i < ch.length; i++) sum += ch[i] * ch[i];
  return Math.sqrt(sum / (ch.length - start));
}

const presetOpts = (id: string) => SCIENTIFIC_FILTER_PRESETS.find((p) => p.id === id)!.opts;

/** Apply a preset to a tone and return the settled output/input ratio. */
function ratioAt(id: string, freq: number): number {
  const t = tone(freq);
  const out = E.DSP.scientificFilter(t, presetOpts(id));
  return settledRms(out.channels[0]) / settledRms(t.channels[0]);
}

describe("SCIENTIFIC_FILTER_PRESETS", () => {
  it("exposes the six named presets", () => {
    expect(SCIENTIFIC_FILTER_PRESETS.map((p) => p.label)).toEqual([
      "Butterworth Low-Pass 1 kHz",
      "Butterworth High-Pass 100 Hz",
      "Telephone Band-Pass",
      "Chebyshev Sharp LP 5 kHz",
      "Band-Stop 800–1200 Hz",
      "Bessel Low-Pass 2 kHz",
      "Elliptic Brickwall LP 3 kHz",
    ]);
  });

  it("Elliptic Brickwall LP 3 kHz keeps 1 kHz and removes 8 kHz", () => {
    expect(ratioAt("sciElliptic", 1000)).toBeGreaterThan(0.8);
    expect(ratioAt("sciElliptic", 8000)).toBeLessThan(0.05);
  });

  it("Butterworth Low-Pass 1 kHz keeps 200 Hz and removes 6 kHz", () => {
    expect(ratioAt("sciLp", 200)).toBeGreaterThan(0.85);
    expect(ratioAt("sciLp", 6000)).toBeLessThan(0.05);
  });

  it("Butterworth High-Pass 100 Hz removes 40 Hz and keeps 1 kHz", () => {
    expect(ratioAt("sciHp", 40)).toBeLessThan(0.3);
    expect(ratioAt("sciHp", 1000)).toBeGreaterThan(0.85);
  });

  it("Telephone Band-Pass keeps 1 kHz and rejects 60 Hz + 8 kHz", () => {
    expect(ratioAt("sciTel", 1000)).toBeGreaterThan(0.8);
    expect(ratioAt("sciTel", 60)).toBeLessThan(0.2);
    expect(ratioAt("sciTel", 8000)).toBeLessThan(0.2);
  });

  it("Chebyshev Sharp LP 5 kHz keeps 1 kHz and removes 10 kHz", () => {
    expect(ratioAt("sciSharp", 1000)).toBeGreaterThan(0.8);
    expect(ratioAt("sciSharp", 10000)).toBeLessThan(0.05);
  });

  it("Band-Stop 800–1200 Hz rejects 1 kHz and keeps 200 Hz + 4 kHz", () => {
    expect(ratioAt("sciNotch", 1000)).toBeLessThan(0.1);
    expect(ratioAt("sciNotch", 200)).toBeGreaterThan(0.85);
    expect(ratioAt("sciNotch", 4000)).toBeGreaterThan(0.85);
  });

  it("Bessel Low-Pass 2 kHz keeps 400 Hz and removes 8 kHz", () => {
    expect(ratioAt("sciBessel", 400)).toBeGreaterThan(0.85);
    expect(ratioAt("sciBessel", 8000)).toBeLessThan(0.1);
  });
});
