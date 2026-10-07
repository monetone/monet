// ─────────────────────────────────────────────────────────────
// ui/convert-presets.test — the shipped Convert Sample Type presets
// ─────────────────────────────────────────────────────────────
// Drives the actual CONVERT_PRESETS through the engine, proving each preset
// changes the channel count or bit depth it promises.

import { describe, expect, it } from "vitest";
import * as E from "../engine";
import { CONVERT_PRESETS } from "./commands";

const SR = 44100;
const stereo = () => E.Generate.sine(1000, 0.05, { sampleRate: SR, amplitude: 0.6, channels: 2 });
const opts = (id: string) => CONVERT_PRESETS.find((p) => p.id === id)!.opts;

function gridError(ch: Float32Array, step: number): number {
  let m = 0;
  for (const v of ch) m = Math.max(m, Math.abs(v / step - Math.round(v / step)));
  return m;
}

describe("CONVERT_PRESETS", () => {
  it("exposes the five named presets", () => {
    expect(CONVERT_PRESETS.map((p) => p.label)).toEqual([
      "To Mono",
      "To Stereo",
      "16-bit (Dither)",
      "12-bit (Dither)",
      "8-bit (Truncate)",
    ]);
  });

  it("To Mono / To Stereo change the channel count", () => {
    expect(E.channelCount(E.DSP.convertSampleType(stereo(), opts("cvtMono")))).toBe(1);
    const m = E.Generate.sine(1000, 0.05, { sampleRate: SR, amplitude: 0.6 });
    expect(E.channelCount(E.DSP.convertSampleType(m, opts("cvtStereo")))).toBe(2);
  });

  it("the bit-depth presets snap to their grid", () => {
    const m = E.Generate.sine(1000, 0.05, { sampleRate: SR, amplitude: 0.6 });
    expect(gridError(E.DSP.convertSampleType(m, opts("cvt16")).channels[0], 1 / 2 ** 15)).toBeLessThan(1e-4);
    expect(gridError(E.DSP.convertSampleType(m, opts("cvt12")).channels[0], 1 / 2 ** 11)).toBeLessThan(1e-4);
    expect(gridError(E.DSP.convertSampleType(m, opts("cvt8")).channels[0], 1 / 2 ** 7)).toBeLessThan(1e-4);
  });
});
