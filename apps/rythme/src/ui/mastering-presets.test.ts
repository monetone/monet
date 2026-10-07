// ─────────────────────────────────────────────────────────────
// ui/mastering-presets.test — the shipped Mastering presets
// ─────────────────────────────────────────────────────────────
// Exercises the actual MASTERING_PRESETS objects through the engine so each
// named preset provably finishes the master (raises loudness within a ceiling),
// the "Loud" preset pushes harder than "Warm", and the "Open" preset is the
// ambience-tail variant.

import { describe, expect, it } from "vitest";
import * as E from "../engine";
import { MASTERING_PRESETS } from "./commands";

const SR = 44100;

const clip = () => E.Generate.sine(440, 0.3, { sampleRate: SR, amplitude: 0.15, channels: 2 });
const rms = (d: E.AudioData) => E.Analysis.analyzeLevels(d).rms;
const rmsHead = (d: E.AudioData, frames: number) => E.Analysis.analyzeLevels(E.sliceFrames(d, 0, frames)).rms;

const presetOpts = (id: string) => MASTERING_PRESETS.find((p) => p.id === id)!.opts;

describe("MASTERING_PRESETS", () => {
  it("exposes the named presets", () => {
    expect(MASTERING_PRESETS.map((p) => p.label)).toEqual(["Warm", "Bright", "Loud", "Wide", "Open"]);
  });

  for (const p of MASTERING_PRESETS) {
    it(`${p.label} raises loudness within its configured ceiling`, () => {
      const s = clip();
      const out = E.DSP.mastering(s, p.opts);
      expect(rmsHead(out, E.frameCount(s))).toBeGreaterThan(rms(s));
      // Peak must respect THIS preset's ceiling, not merely 0 dBFS.
      expect(E.Analysis.analyzeLevels(out).peak).toBeLessThanOrEqual(E.dbToGain(p.opts.ceilingDb ?? -1) + 1e-4);
    });
  }

  it("Loud pushes harder than Warm", () => {
    const s = clip();
    const warm = E.DSP.mastering(s, presetOpts("masterWarm"));
    const loud = E.DSP.mastering(s, presetOpts("masterLoud"));
    expect(rms(loud)).toBeGreaterThan(rms(warm));
  });

  it("Open is the ambience-tail mastering preset", () => {
    const s = clip();
    const open = E.DSP.mastering(s, presetOpts("masterOpen"));
    const warm = E.DSP.mastering(s, presetOpts("masterWarm"));
    expect(E.frameCount(open)).toBeGreaterThan(E.frameCount(s));
    expect(E.frameCount(warm)).toBe(E.frameCount(s));
  });
});
