// ─────────────────────────────────────────────────────────────
// ui/echo-presets.test — the shipped Echo presets
// ─────────────────────────────────────────────────────────────
// Exercises the actual ECHO_PRESETS objects through the engine so each named
// preset provably produces repeats, and a darker preset's repeats carry less
// high-frequency energy than a brighter one's.

import { describe, expect, it } from "vitest";
import * as E from "../engine";
import { ECHO_PRESETS } from "./commands";

const SR = 44100;

const burst = () => E.Generate.whiteNoise(64 / SR, { sampleRate: SR, amplitude: 0.8, seed: 11 });

function rms(ch: Float32Array, from = 0, to = ch.length): number {
  let s = 0;
  for (let i = from; i < to; i++) s += ch[i] * ch[i];
  return Math.sqrt(s / Math.max(1, to - from));
}

const FLAT_EQ = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const presetOpts = (id: string) => ECHO_PRESETS.find((p) => p.id === id)!.opts;

/** Absolute high-frequency (>4 kHz) energy of the wet tail. */
function tailHf(opts: E.DSP.EchoOptions): number {
  const src = burst();
  const n = src.channels[0].length;
  return rms(E.DSP.highpass(E.DSP.echo(src, opts), 4000).channels[0], n);
}

/**
 * How much a preset's own EQ darkens its tail, relative to the SAME preset with a
 * flat EQ — normalizes out the preset's delay/feedback/level so only brightness
 * is compared. Smaller = darker.
 */
function darkness(opts: E.DSP.EchoOptions): number {
  return tailHf(opts) / Math.max(1e-12, tailHf({ ...opts, eqGainsDb: FLAT_EQ }));
}

describe("ECHO_PRESETS", () => {
  it("exposes the three named presets", () => {
    expect(ECHO_PRESETS.map((p) => p.label)).toEqual(["Slapback", "Tape Echo", "Dub"]);
  });

  for (const p of ECHO_PRESETS) {
    it(`${p.label} produces audible repeats in the tail`, () => {
      const src = burst();
      const n = src.channels[0].length;
      const out = E.DSP.echo(src, p.opts);
      expect(rms(out.channels[0], n)).toBeGreaterThan(1e-3);
    });
  }

  it("the darker Dub preset attenuates its repeats' HF more than the brighter Slapback", () => {
    expect(darkness(presetOpts("echoDub"))).toBeLessThan(darkness(presetOpts("echoSlap")) * 0.9);
  });
});
