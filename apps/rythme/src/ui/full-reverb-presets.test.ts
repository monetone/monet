// ─────────────────────────────────────────────────────────────
// ui/full-reverb-presets.test — the shipped Full Reverb presets
// ─────────────────────────────────────────────────────────────
// Drives the actual FULL_REVERB_PRESETS objects through the engine so each named
// space provably adds a reverb tail, and larger rooms make longer tails.

import { describe, expect, it } from "vitest";
import * as E from "../engine";
import { FULL_REVERB_PRESETS } from "./commands";

const SR = 44100;

const src = () => E.Generate.whiteNoise(0.1, { sampleRate: SR, amplitude: 0.5, seed: 5, channels: 1 });

function tailRms(d: E.AudioData, fromInputLen: number): number {
  const ch = d.channels[0];
  let s = 0;
  for (let i = fromInputLen; i < ch.length; i++) s += ch[i] * ch[i];
  return Math.sqrt(s / Math.max(1, ch.length - fromInputLen));
}

const opts = (id: string) => FULL_REVERB_PRESETS.find((p) => p.id === id)!.opts;

describe("FULL_REVERB_PRESETS", () => {
  it("exposes the five named spaces", () => {
    expect(FULL_REVERB_PRESETS.map((p) => p.label)).toEqual([
      "Small Room",
      "Chamber",
      "Concert Hall",
      "Cathedral",
      "Dark Room",
    ]);
  });

  it("every preset appends a reverb tail with real energy", () => {
    const s = src();
    const n = E.frameCount(s);
    for (const p of FULL_REVERB_PRESETS) {
      const out = E.DSP.fullReverb(s, p.opts);
      expect(E.frameCount(out)).toBeGreaterThan(n);
      expect(tailRms(out, n)).toBeGreaterThan(1e-3);
    }
  });

  it("the Cathedral tail is much longer than the Small Room tail", () => {
    const s = src();
    const room = E.frameCount(E.DSP.fullReverb(s, opts("frvRoom")));
    const cathedral = E.frameCount(E.DSP.fullReverb(s, opts("frvCathedral")));
    expect(cathedral).toBeGreaterThan(room * 3);
  });

  it("the Dark Room tail has less high-frequency energy than the Concert Hall", () => {
    const s = src();
    const n = E.frameCount(s);
    const dark = E.DSP.fullReverb(s, opts("frvDark"));
    const hall = E.DSP.fullReverb(s, opts("frvHall"));
    const hfDark = tailRms(E.DSP.highpass(dark, 4000), n);
    const hfHall = tailRms(E.DSP.highpass(hall, 4000), n);
    expect(hfDark).toBeLessThan(hfHall);
  });
});
