// ─────────────────────────────────────────────────────────────
// ui/hiss-reduction-presets.test — the shipped Hiss Reduction presets
// ─────────────────────────────────────────────────────────────
// Exercises the actual HISS_REDUCTION_PRESETS objects through the engine so each
// named preset provably reduces a hiss clip's level, and a stronger preset
// reduces more than a lighter one.

import { describe, expect, it } from "vitest";
import * as E from "../engine";
import { HISS_REDUCTION_PRESETS } from "./commands";

const SR = 44100;

const hissClip = () => ({ sampleRate: SR, channels: [E.Generate.whiteNoise(0.6, { sampleRate: SR, amplitude: 0.03, seed: 5 }).channels[0]] });

function rms(ch: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i];
  return Math.sqrt(sum / ch.length);
}

const presetOpts = (id: string) => HISS_REDUCTION_PRESETS.find((p) => p.id === id)!.opts;

describe("HISS_REDUCTION_PRESETS", () => {
  it("exposes the three named presets", () => {
    expect(HISS_REDUCTION_PRESETS.map((p) => p.label)).toEqual(["Light", "Medium", "Strong"]);
  });

  for (const p of HISS_REDUCTION_PRESETS) {
    it(`${p.label} reduces a hiss clip's level`, () => {
      const s = hissClip();
      const out = E.DSP.hissReduction(s, p.opts);
      expect(rms(out.channels[0])).toBeLessThan(rms(s.channels[0]));
    });
  }

  it("Strong reduces more than Light", () => {
    const s = hissClip();
    const light = E.DSP.hissReduction(s, presetOpts("hissLight"));
    const strong = E.DSP.hissReduction(s, presetOpts("hissStrong"));
    expect(rms(strong.channels[0])).toBeLessThan(rms(light.channels[0]));
  });
});
