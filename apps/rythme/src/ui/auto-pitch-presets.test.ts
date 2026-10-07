// ─────────────────────────────────────────────────────────────
// ui/auto-pitch-presets.test — the shipped Automatic Pitch Correction presets
// ─────────────────────────────────────────────────────────────
// Exercises the actual AUTO_PITCH_PRESETS objects through the engine so each
// named preset provably retunes a detuned tone toward a semitone, and a
// stronger preset corrects more than a gentler one.

import { describe, expect, it } from "vitest";
import * as E from "../engine";
import { AUTO_PITCH_PRESETS } from "./commands";

const SR = 44100;

// 450 Hz sits between A4 (440) and A#4 (~466); nearest is A4.
const detuned = () => E.Generate.sine(450, 0.5, { sampleRate: SR, amplitude: 0.5 });

const presetOpts = (id: string) => AUTO_PITCH_PRESETS.find((p) => p.id === id)!.opts;

describe("AUTO_PITCH_PRESETS", () => {
  it("exposes the three named presets", () => {
    expect(AUTO_PITCH_PRESETS.map((p) => p.label)).toEqual(["Tune", "Medium", "Gentle"]);
  });

  for (const p of AUTO_PITCH_PRESETS) {
    it(`${p.label} pulls a detuned tone by its strength toward the nearest semitone`, () => {
      const out = E.DSP.autoPitchCorrect(detuned(), p.opts);
      const corrected = E.DSP.detectPitch(out);
      // 450 Hz is +0.389 semitone above A4; strength s shifts it by -0.389·s.
      const errorSemis = Math.round(12 * Math.log2(450 / 440)) - 12 * Math.log2(450 / 440);
      const expected = 450 * Math.pow(2, (errorSemis * (p.opts.strength ?? 1)) / 12);
      expect(Math.abs(corrected - expected)).toBeLessThan(2);
    });
  }

  it("Tune corrects more than Gentle", () => {
    const tune = E.DSP.detectPitch(E.DSP.autoPitchCorrect(detuned(), presetOpts("tuneFull")));
    const gentle = E.DSP.detectPitch(E.DSP.autoPitchCorrect(detuned(), presetOpts("tuneGentle")));
    // Full tune lands closer to 440 (lower) than the gentle nudge.
    expect(tune).toBeLessThan(gentle);
  });
});
