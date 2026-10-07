// ─────────────────────────────────────────────────────────────
// ui/adaptive-nr-presets.test — the shipped Adaptive Noise Reduction presets
// ─────────────────────────────────────────────────────────────
// Exercises the actual ADAPTIVE_NR_PRESETS objects through the engine so each
// named preset provably reduces a noise clip, and a stronger preset reduces more.

import { describe, expect, it } from "vitest";
import * as E from "../engine";
import { ADAPTIVE_NR_PRESETS } from "./commands";

const SR = 44100;

const noiseClip = () => ({ sampleRate: SR, channels: [E.Generate.whiteNoise(0.6, { sampleRate: SR, amplitude: 0.03, seed: 5 }).channels[0]] });

function rms(ch: Float32Array): number {
  let s = 0;
  for (let i = 0; i < ch.length; i++) s += ch[i] * ch[i];
  return Math.sqrt(s / ch.length);
}

const presetOpts = (id: string) => ADAPTIVE_NR_PRESETS.find((p) => p.id === id)!.opts;

describe("ADAPTIVE_NR_PRESETS", () => {
  it("exposes the three named presets", () => {
    expect(ADAPTIVE_NR_PRESETS.map((p) => p.label)).toEqual(["Light", "Medium", "Strong"]);
  });

  for (const p of ADAPTIVE_NR_PRESETS) {
    it(`${p.label} reduces a noise clip`, () => {
      const s = noiseClip();
      const out = E.DSP.adaptiveNoiseReduction(s, p.opts);
      expect(rms(out.channels[0])).toBeLessThan(rms(s.channels[0]));
    });
  }

  it("Strong reduces more than Light", () => {
    const s = noiseClip();
    const light = E.DSP.adaptiveNoiseReduction(s, presetOpts("anrLight"));
    const strong = E.DSP.adaptiveNoiseReduction(s, presetOpts("anrStrong"));
    expect(rms(strong.channels[0])).toBeLessThan(rms(light.channels[0]));
  });
});
