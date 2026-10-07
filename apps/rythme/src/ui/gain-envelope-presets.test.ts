// ─────────────────────────────────────────────────────────────
// ui/gain-envelope-presets.test — the shipped Gain Envelope presets
// ─────────────────────────────────────────────────────────────
// Drives the actual GAIN_ENVELOPE_PRESETS through the engine on a unity (all-ones)
// signal so the output equals the envelope itself, proving each named shape.

import { describe, expect, it } from "vitest";
import * as E from "../engine";
import { GAIN_ENVELOPE_PRESETS } from "./commands";

const SR = 44100;

const ones = (n: number): E.AudioData => ({ sampleRate: SR, channels: [new Float32Array(n).fill(1)] });

const opts = (id: string) => GAIN_ENVELOPE_PRESETS.find((p) => p.id === id)!.opts;
const at = (d: E.AudioData, frac: number) => d.channels[0][Math.round(frac * (d.channels[0].length - 1))];

describe("GAIN_ENVELOPE_PRESETS", () => {
  it("exposes the six named presets", () => {
    expect(GAIN_ENVELOPE_PRESETS.map((p) => p.label)).toEqual([
      "Fade In",
      "Fade Out",
      "Fade In/Out",
      "Duck Middle",
      "Swell",
      "Tremolo Shape",
    ]);
  });

  it("Fade In rises from silence to unity", () => {
    const out = E.DSP.gainEnvelope(ones(2001), opts("genFadeIn"));
    expect(at(out, 0)).toBeCloseTo(0, 4);
    expect(at(out, 1)).toBeCloseTo(1, 4);
  });

  it("Fade Out falls from unity to silence", () => {
    const out = E.DSP.gainEnvelope(ones(2001), opts("genFadeOut"));
    expect(at(out, 0)).toBeCloseTo(1, 4);
    expect(at(out, 1)).toBeCloseTo(0, 4);
  });

  it("Fade In/Out is silent at both ends and full in the middle", () => {
    const out = E.DSP.gainEnvelope(ones(2001), opts("genFadeInOut"));
    expect(at(out, 0)).toBeCloseTo(0, 4);
    expect(at(out, 0.5)).toBeCloseTo(1, 3);
    expect(at(out, 1)).toBeCloseTo(0, 4);
  });

  it("Duck Middle dips in the centre and restores the ends", () => {
    const out = E.DSP.gainEnvelope(ones(2001), opts("genDuck"));
    expect(at(out, 0)).toBeCloseTo(1, 4);
    expect(at(out, 0.5)).toBeCloseTo(0.25, 2);
    expect(at(out, 1)).toBeCloseTo(1, 4);
  });

  it("Swell peaks in the centre", () => {
    const out = E.DSP.gainEnvelope(ones(2001), opts("genSwell"));
    expect(at(out, 0.5)).toBeGreaterThan(at(out, 0));
    expect(at(out, 0.5)).toBeCloseTo(1, 2);
  });

  it("Tremolo Shape oscillates between full and dipped", () => {
    const out = E.DSP.gainEnvelope(ones(4001), opts("genTremolo"));
    expect(at(out, 0.25)).toBeLessThan(0.5); // dipped
    expect(at(out, 0.5)).toBeCloseTo(1, 2); // full
    expect(at(out, 0.75)).toBeLessThan(0.5); // dipped again
  });
});
