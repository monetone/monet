// ─────────────────────────────────────────────────────────────
// ui/notch-presets.test — the shipped Notch Filter presets
// ─────────────────────────────────────────────────────────────
// Exercises the actual NOTCH_FILTER_PRESETS objects through the engine so each
// named preset provably attenuates its target frequency.

import { describe, expect, it } from "vitest";
import * as E from "../engine";
import { NOTCH_FILTER_PRESETS } from "./commands";

const SR = 44100;

// Longer tones so the second-half window is well past the (low-freq) IIR ramp.
const tone = (freq: number) => E.Generate.sine(freq, 0.4, { sampleRate: SR, amplitude: 0.5 });

function settledRms(ch: Float32Array): number {
  let sum = 0;
  const start = ch.length >> 1;
  for (let i = start; i < ch.length; i++) sum += ch[i] * ch[i];
  return Math.sqrt(sum / (ch.length - start));
}

const presetOpts = (id: string) => NOTCH_FILTER_PRESETS.find((p) => p.id === id)!.opts;

/** Apply a preset to a tone at `freq` and return the settled output/input ratio. */
function attenuationAt(id: string, freq: number): number {
  const t = tone(freq);
  const out = E.DSP.notchFilter(t, presetOpts(id));
  return settledRms(out.channels[0]) / settledRms(t.channels[0]);
}

describe("NOTCH_FILTER_PRESETS", () => {
  it("exposes the four named presets", () => {
    expect(NOTCH_FILTER_PRESETS.map((p) => p.label)).toEqual(["60 Hz Hum", "50 Hz Hum", "A 440 Pitch", "DTMF Tones"]);
  });

  it("60 Hz Hum attenuates a 60 Hz tone", () => {
    expect(attenuationAt("notch60", 60)).toBeLessThan(0.5);
  });

  it("50 Hz Hum attenuates a 50 Hz tone", () => {
    expect(attenuationAt("notch50", 50)).toBeLessThan(0.5);
  });

  it("A 440 Pitch attenuates a 440 Hz tone", () => {
    expect(attenuationAt("notchA440", 440)).toBeLessThan(0.2);
  });

  it("DTMF Tones attenuates a 697 Hz touch-tone", () => {
    expect(attenuationAt("notchDtmf", 697)).toBeLessThan(0.2);
  });
});
