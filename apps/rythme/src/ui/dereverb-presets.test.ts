// ─────────────────────────────────────────────────────────────
// ui/dereverb-presets.test — the shipped DeReverb presets
// ─────────────────────────────────────────────────────────────
// Exercises the actual DEREVERB_PRESETS objects through the engine so each named
// preset provably reduces a reverberant tail, and Strong reduces more than Light.

import { describe, expect, it } from "vitest";
import * as E from "../engine";
import { DEREVERB_PRESETS } from "./commands";

const SR = 44100;
const N = 16384;
const ONSET = 512;
const TAU = 0.06;
const TAIL_FROM = 4096;

/** A direct onset burst followed by a decaying broadband tail (synthetic reverb). */
function reverberant(): E.AudioData {
  const base = E.Generate.whiteNoise(N / SR, { sampleRate: SR, amplitude: 1, seed: 7 }).channels[0];
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const env = i < ONSET ? 1 : 0.7 * Math.exp(-(i - ONSET) / (TAU * SR));
    out[i] = base[i] * env;
  }
  return { sampleRate: SR, channels: [out] };
}

function tailRms(ch: Float32Array): number {
  let s = 0;
  for (let i = TAIL_FROM; i < N; i++) s += ch[i] * ch[i];
  return Math.sqrt(s / (N - TAIL_FROM));
}

const presetOpts = (id: string) => DEREVERB_PRESETS.find((p) => p.id === id)!.opts;

describe("DEREVERB_PRESETS", () => {
  it("exposes the three named presets", () => {
    expect(DEREVERB_PRESETS.map((p) => p.label)).toEqual(["Light", "Medium", "Strong"]);
  });

  for (const p of DEREVERB_PRESETS) {
    it(`${p.label} reduces a reverberant tail`, () => {
      const dry = reverberant();
      const out = E.DSP.deReverb(dry, p.opts);
      expect(tailRms(out.channels[0])).toBeLessThan(tailRms(dry.channels[0]));
    });
  }

  it("Strong reduces the tail more than Light", () => {
    const dry = reverberant();
    const strong = tailRms(E.DSP.deReverb(dry, presetOpts("drStrong")).channels[0]);
    const light = tailRms(E.DSP.deReverb(dry, presetOpts("drLight")).channels[0]);
    expect(strong).toBeLessThan(light);
  });
});
