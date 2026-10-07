// ─────────────────────────────────────────────────────────────
// ui/phase-shifter-presets.test — the shipped Graphic Phase Shifter presets
// ─────────────────────────────────────────────────────────────
// Drives the actual GRAPHIC_PHASE_SHIFTER_PRESETS through the engine: every
// preset preserves energy (all-pass), the 180° preset inverts, and the
// one-channel "Simulated Stereo" preset only touches the left channel.

import { describe, expect, it } from "vitest";
import * as E from "../engine";
import { GRAPHIC_PHASE_SHIFTER_PRESETS } from "./commands";

const SR = 44100;

const tone = (f: number) => E.Generate.sine(f, 0.3, { sampleRate: SR, amplitude: 0.5 });

function rms(ch: Float32Array, a = 0, b = ch.length): number {
  let s = 0;
  for (let i = a; i < b; i++) s += ch[i] * ch[i];
  return Math.sqrt(s / Math.max(1, b - a));
}

function interiorMaxDiff(a: Float32Array, b: Float32Array, guard = 2048): number {
  let m = 0;
  for (let i = guard; i < a.length - guard; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

const opts = (id: string) => GRAPHIC_PHASE_SHIFTER_PRESETS.find((p) => p.id === id)!.opts;

describe("GRAPHIC_PHASE_SHIFTER_PRESETS", () => {
  it("exposes the five named presets", () => {
    expect(GRAPHIC_PHASE_SHIFTER_PRESETS.map((p) => p.label)).toEqual([
      "Simulated Stereo",
      "Wide Image",
      "Invert Highs",
      "Quarter Wave (90°)",
      "Polarity Invert (180°)",
    ]);
  });

  it("every preset preserves broadband energy (all-pass)", () => {
    const noise = E.Generate.whiteNoise(0.3, { sampleRate: SR, amplitude: 0.5, seed: 2, channels: 2 });
    const a = E.frameCount(noise) >> 2;
    const b = E.frameCount(noise) - a;
    const inRms = rms(noise.channels[0], a, b);
    for (const p of GRAPHIC_PHASE_SHIFTER_PRESETS) {
      const out = E.DSP.graphicPhaseShifter(noise, p.opts);
      // Channel 0 is shifted by every preset; its magnitude must survive.
      const ratio = rms(out.channels[0], a, b) / inRms;
      expect(ratio).toBeGreaterThan(0.95);
      expect(ratio).toBeLessThan(1.05);
    }
  });

  it("Polarity Invert (180°) inverts a mid tone", () => {
    const t = tone(1000);
    const out = E.DSP.graphicPhaseShifter(t, opts("gpsInvert"));
    const neg = t.channels[0].map((v) => -v) as Float32Array;
    expect(interiorMaxDiff(out.channels[0], neg)).toBeLessThan(1e-3);
  });

  it("Simulated Stereo only alters the left channel", () => {
    const m = tone(1000).channels[0];
    const stereo: E.AudioData = { sampleRate: SR, channels: [Float32Array.from(m), Float32Array.from(m)] };
    const out = E.DSP.graphicPhaseShifter(stereo, opts("gpsSimStereo"));
    expect(interiorMaxDiff(out.channels[1], m)).toBe(0); // right untouched
    expect(interiorMaxDiff(out.channels[0], m)).toBeGreaterThan(1e-3); // left phase-warped
  });
});
