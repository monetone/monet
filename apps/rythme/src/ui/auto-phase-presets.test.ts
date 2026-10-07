// ─────────────────────────────────────────────────────────────
// ui/auto-phase-presets.test — the shipped Automatic Phase Correction presets
// ─────────────────────────────────────────────────────────────
// Drives the actual AUTO_PHASE_PRESETS objects through the engine: the aligning
// presets remove a known inter-channel delay, and "Fix Polarity Only" leaves the
// timing alone while still flipping an inverted channel.

import { describe, expect, it } from "vitest";
import * as E from "../engine";
import { AUTO_PHASE_PRESETS } from "./commands";

const SR = 44100;

const noise = () => E.Generate.whiteNoise(0.2, { sampleRate: SR, amplitude: 0.5, seed: 4, channels: 1 }).channels[0];

function delayBy(ch: Float32Array, d: number): Float32Array {
  const out = new Float32Array(ch.length);
  for (let i = 0; i < ch.length; i++) {
    const j = i - d;
    if (j >= 0 && j < ch.length) out[i] = ch[j];
  }
  return out;
}

function bestLag(a: Float32Array, b: Float32Array, max = 80): number {
  const n = a.length;
  let lagAt = 0;
  let best = -Infinity;
  for (let lag = -max; lag <= max; lag++) {
    let dot = 0;
    for (let i = 200; i < n - 200; i++) {
      const j = i + lag;
      dot += a[i] * (j >= 0 && j < n ? b[j] : 0);
    }
    if (Math.abs(dot) > best) {
      best = Math.abs(dot);
      lagAt = lag;
    }
  }
  return lagAt;
}

const opts = (id: string) => AUTO_PHASE_PRESETS.find((p) => p.id === id)!.opts;

describe("AUTO_PHASE_PRESETS", () => {
  it("exposes the four named presets", () => {
    expect(AUTO_PHASE_PRESETS.map((p) => p.label)).toEqual([
      "Auto Align",
      "Tight Align (2 ms)",
      "Wide Align (20 ms)",
      "Fix Polarity Only",
    ]);
  });

  it("the aligning presets remove a known inter-channel delay", () => {
    const base = noise();
    for (const id of ["aphAuto", "aphTight", "aphWide"]) {
      const d: E.AudioData = { sampleRate: SR, channels: [Float32Array.from(base), delayBy(base, 12)] };
      const out = E.DSP.autoPhaseCorrect(d, opts(id));
      expect(Math.abs(bestLag(out.channels[0], out.channels[1]))).toBeLessThanOrEqual(1);
    }
  });

  it("Fix Polarity Only flips an aligned inverted channel", () => {
    const base = noise();
    const inv = base.map((v) => -v) as Float32Array;
    const out = E.DSP.autoPhaseCorrect({ sampleRate: SR, channels: [Float32Array.from(base), inv] }, opts("aphPolarity"));
    // R was −base; after the polarity fix it should be ≈ +base → positive lag-0 correlation.
    let dot = 0;
    for (let i = 0; i < base.length; i++) dot += out.channels[0][i] * out.channels[1][i];
    expect(dot).toBeGreaterThan(0);
  });

  it("Fix Polarity Only does not time-align (leaves the delay intact)", () => {
    const base = noise();
    const out = E.DSP.autoPhaseCorrect({ sampleRate: SR, channels: [Float32Array.from(base), delayBy(base, 25)] }, opts("aphPolarity"));
    expect(bestLag(out.channels[0], out.channels[1])).toBe(25);
  });
});
