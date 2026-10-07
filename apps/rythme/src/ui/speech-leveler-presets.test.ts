// ─────────────────────────────────────────────────────────────
// ui/speech-leveler-presets.test — the shipped Speech Volume Leveler presets
// ─────────────────────────────────────────────────────────────
// Exercises the actual SPEECH_LEVELER_PRESETS objects through the engine so each
// named preset provably levels a loud/quiet clip toward a more uniform loudness.

import { describe, expect, it } from "vitest";
import * as E from "../engine";
import { SPEECH_LEVELER_PRESETS } from "./commands";

const SR = 44100;

/** A clip: loud (0.5) for the first half, quiet (0.05) for the second. Halves
 *  are long (1.5 s) so the presets' default 300 ms window settles before the
 *  measured tail. */
function twoLevel() {
  const a = E.Generate.sine(300, 1.5, { sampleRate: SR, amplitude: 0.5 }).channels[0];
  const b = E.Generate.sine(300, 1.5, { sampleRate: SR, amplitude: 0.05 }).channels[0];
  const out = new Float32Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return { sampleRate: SR, channels: [out] };
}

/** RMS (dB) over the settled tail (last 25%) of a window. */
function tailRmsDb(ch: Float32Array, from: number, to: number): number {
  const a = Math.floor(from + (to - from) * 0.75);
  let sum = 0;
  for (let i = a; i < to; i++) sum += ch[i] * ch[i];
  return 20 * Math.log10(Math.sqrt(sum / (to - a)) + 1e-12);
}

function halfGap(ch: Float32Array): number {
  const mid = ch.length / 2;
  return Math.abs(tailRmsDb(ch, 0, mid) - tailRmsDb(ch, mid, ch.length));
}

describe("SPEECH_LEVELER_PRESETS", () => {
  it("exposes the three named presets", () => {
    expect(SPEECH_LEVELER_PRESETS.map((p) => p.label)).toEqual(["Gentle", "Medium", "Strong"]);
  });

  for (const p of SPEECH_LEVELER_PRESETS) {
    it(`${p.label} brings a loud/quiet clip's halves closer together`, () => {
      const s = twoLevel();
      const inGap = halfGap(s.channels[0]);
      const out = E.DSP.speechLeveler(s, p.opts);
      // Convergence scales with the leveling amount, so a higher-amount preset
      // must close the gap by at least proportionally more.
      const maxRemaining = inGap * (1 - (p.opts.amount ?? 0.75) * 0.5);
      expect(halfGap(out.channels[0])).toBeLessThan(maxRemaining);
    });
  }
});
